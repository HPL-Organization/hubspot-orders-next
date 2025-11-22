import { NextRequest } from "next/server";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { getValidToken } from "../../../../../lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;

const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

const EXPORT_FOLDER_ID = Number(process.env.NS_EXPORT_FOLDER_ID || 2279);
const ITEM_AVAIL_FILE_NAME = "item_availability.jsonl";

// Restlet script that streams the JSONL (your script id: 2947)
const RL_SCRIPT_ID = String(process.env.NS_ITEM_AVAIL_RL_SCRIPT_ID || 2947);
const RL_DEPLOY_ID = String(
  process.env.NS_ITEM_AVAIL_RL_DEPLOY_ID || "customdeploy1"
);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/* ---------- Helpers ---------- */

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "transient, maxpagesize=1000",
  };
}

function restletUrl(accountId: string) {
  return `https://${accountId}.app.netsuite.com/app/site/hosting/restlet.nl`;
}

function asJson(data: any) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data && typeof data === "object" ? data : null;
}

function stripBom(s: string) {
  if (s && s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

// Small sleep helper for retries (if needed later)
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Minimal SuiteQL helper (with basic retry on 429/503)
async function netsuiteQuery(
  q: string,
  headers: Record<string, string>,
  tag?: string
) {
  let attempt = 0;
  const delays = [500, 1000, 2000, 4000, 8000];
  const MAX_WAIT_MS = 120000;

  for (;;) {
    try {
      return await axios.post(
        `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
        { q },
        { headers }
      );
    } catch (err: any) {
      const status = err?.response?.status;
      const headersMap = err?.response?.headers || {};
      const ra =
        headersMap["retry-after"] ??
        headersMap["Retry-After"] ??
        headersMap["Retry-after"];

      const code =
        err?.response?.data?.["o:errorDetails"]?.[0]?.["o:errorCode"];

      if (
        status === 429 ||
        status === 503 ||
        code === "CONCURRENCY_LIMIT_EXCEEDED"
      ) {
        let backoff = delays[Math.min(attempt, delays.length - 1)];
        if (typeof ra === "string" && /^\d+$/.test(ra.trim())) {
          backoff = Math.max(backoff, parseInt(ra.trim(), 10) * 1000);
        }
        await sleep(Math.min(backoff, MAX_WAIT_MS));
        attempt++;
        continue;
      }

      const e = new Error(`SuiteQL ${tag || ""} failed`);
      (e as any).details =
        typeof err?.response?.data === "string"
          ? err.response.data
          : err?.response?.data;
      throw e;
    }
  }
}

async function getFileIdByNameInFolder(
  headers: Record<string, string>,
  name: string,
  folderId: number
): Promise<number | null> {
  const safeName = name.replace(/'/g, "''");
  const q = `
    SELECT id
    FROM file
    WHERE name = '${safeName}'
      AND folder = ${folderId}
    ORDER BY id DESC
    FETCH NEXT 1 ROWS ONLY
  `;
  const r = await netsuiteQuery(q, headers, "findFile");
  const id = Number(r?.data?.items?.[0]?.id);
  return Number.isFinite(id) ? id : null;
}

// Stream JSONL pages from the Restlet, by file id
async function* restletStreamJsonlPages(
  token: string,
  fileId: number,
  pageLines = 2000
) {
  const url = restletUrl(NETSUITE_ACCOUNT_ID);
  let lineStart = 0;

  const baseParams: Record<string, string> = {
    script: RL_SCRIPT_ID,
    deploy: RL_DEPLOY_ID,
    id: String(fileId),
  };

  for (;;) {
    const r = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      params: {
        ...baseParams,
        lineStart: String(lineStart),
        maxLines: String(pageLines),
      },
      transformResponse: (x) => x,
      validateStatus: () => true,
    });

    const body = asJson(r.data);
    if (r.status < 200 || r.status >= 300 || !body?.ok) {
      const e = new Error(`RestletFetchFailed ${r.status}`);
      (e as any).details =
        typeof r.data === "string" ? r.data : JSON.stringify(r.data);
      throw e;
    }

    const text = stripBom(String(body.data || ""));
    const lines = text.length ? text.split(/\r?\n/) : [];
    const page: any[] = [];

    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try {
        page.push(JSON.parse(s));
      } catch {
        // ignore bad lines
      }
    }

    if (page.length) yield page;

    const returned = Number(body.linesReturned || 0);
    const done = body.done || returned < pageLines;
    if (done) break;

    lineStart += returned;
  }
}

// Coercers
function coerceBigint(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).replace(/[, ]/g, "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function coerceNumeric(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ---------- Route ---------- */

export async function POST(req: NextRequest) {
  try {
    // Auth check
    if (
      !ADMIN_SYNC_SECRET ||
      req.headers.get(ADMIN_SECRET_HEADER) !== ADMIN_SYNC_SECRET
    ) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401 }
      );
    }

    const token = await getValidToken();
    const headers = authHeaders(token);

    // 1) Find latest item_availability.jsonl file by name + folder
    const fileId = await getFileIdByNameInFolder(
      headers,
      ITEM_AVAIL_FILE_NAME,
      EXPORT_FOLDER_ID
    );

    if (!fileId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "FileNotFound",
          details: `No file named '${ITEM_AVAIL_FILE_NAME}' in folder ${EXPORT_FOLDER_ID}`,
        }),
        { status: 404 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let total = 0;
    let updated = 0;

    // 2) Stream the JSONL file via Restlet by ID (this fixes InvalidId)
    for await (const page of restletStreamJsonlPages(token, fileId, 2000)) {
      total += page.length;

      // Accept a few possible shapes from the JSONL script:
      // { item_id, available }
      // { netsuite_id, available }
      // { item_id, quantityavailable }  etc.
      const mapped = page
        .map((r: any) => {
          const netsuite_id = coerceBigint(r.item_id ?? r.netsuite_id ?? r.id);
          const available = coerceNumeric(
            r.available ?? r.quantityavailable ?? r.qty_available
          );
          if (netsuite_id == null || available == null) return null;
          return { netsuite_id, available };
        })
        .filter(
          (x): x is { netsuite_id: number; available: number } => x !== null
        );

      if (!mapped.length) continue;

      // Chunk RPC calls so we don't send a huge JSON param
      const chunkSize = 1000;
      for (let i = 0; i < mapped.length; i += chunkSize) {
        const chunk = mapped.slice(i, i + chunkSize);
        const { error } = await supabase.rpc(
          "nsw_update_ns_products_available",
          { p_rows: chunk }
        );
        if (error) throw error;
        updated += chunk.length;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        counts: {
          records_in_file: total,
          rows_updated: updated,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    const msg = String(err?.message || "SyncFailed");
    return new Response(
      JSON.stringify({
        ok: false,
        error: msg,
        details:
          typeof err?.details === "string"
            ? err.details
            : err?.details
            ? JSON.stringify(err.details)
            : undefined,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
