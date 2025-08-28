// lib/netsuite/listPaymentOptions.ts
import { getValidToken } from "./token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;

//const ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const RECORD_BASE = `https://${ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/record/v1`;
const QUERY_BASE = `https://${ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;

export type NsPaymentOption = { id: string; name: string };

async function fetchViaRecordsAPI(pmId: number): Promise<NsPaymentOption[]> {
  const token = await getValidToken();

  // List and filter client-side (reliable across roles)
  const res = await fetch(`${RECORD_BASE}/paymentOption?limit=1000`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Parse error: ${text}`);
  }
  if (!res.ok)
    throw new Error(
      json?.title || json?.message || `HTTP ${res.status}: ${text}`
    );

  const items: any[] = Array.isArray(json?.items) ? json.items : [];
  return items
    .filter((row) => {
      const inactive = row?.isInactive === true || row?.isinactive === "T";
      if (inactive) return false;
      const methodId =
        row?.paymentMethod?.id ??
        row?.paymentmethod?.id ??
        row?.paymentMethod ??
        row?.paymentmethod;
      return Number(methodId) === Number(pmId);
    })
    .map((row) => ({
      id: String(row.id),
      name: String(row.name ?? `Option ${row.id}`),
    }));
}

async function fetchViaSuiteQL(pmId: number): Promise<NsPaymentOption[]> {
  const token = await getValidToken();
  const q = `
    SELECT id, name
    FROM paymentoption
    WHERE isinactive = 'F' AND paymentmethod = ${Number(pmId)}
    ORDER BY name
  `;

  const res = await fetch(QUERY_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q }),
  });

  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Parse error: ${text}`);
  }
  if (!res.ok)
    throw new Error(
      json?.title || json?.message || `HTTP ${res.status}: ${text}`
    );

  const items: any[] = Array.isArray(json?.items) ? json.items : [];
  return items.map((r) => ({ id: String(r.id), name: String(r.name) }));
}

export async function listPaymentOptionsForMethod(
  pmId: number | string
): Promise<NsPaymentOption[]> {
  const id = Number(pmId);
  try {
    const recs = await fetchViaRecordsAPI(id);
    if (recs.length) return recs;
  } catch (_) {
    /* fall back */
  }
  // Fallback to SuiteQL (in case role blocks the list)
  try {
    return await fetchViaSuiteQL(id);
  } catch (_) {
    // If both fail, return empty (means either no options or insufficient perms)
    return [];
  }
}
