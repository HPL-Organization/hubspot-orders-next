// lib/netsuite/listPaymentMethods.ts
import { getValidToken } from "./token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const RECORD_BASE = `https://${ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/record/v1`;

export type NsPaymentMethod = {
  id: string;
  name: string;
  isInactive: boolean;
  undepositedDefault?: boolean | null;
  defaultAccountId?: string | null;
  defaultAccountName?: string | null;
};

async function getJson(res: Response) {
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
  return json;
}

async function listIds(
  accessToken: string,
  includeInactive = false
): Promise<string[]> {
  const url = new URL(`${RECORD_BASE}/paymentMethod`);
  url.searchParams.set("limit", "1000");
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const json = await getJson(res);
  const items = Array.isArray(json?.items) ? json.items : [];
  return items
    .filter(
      (pm: any) =>
        includeInactive || !(pm?.isInactive === true || pm?.isinactive === "T")
    )
    .map((pm: any) => String(pm.id));
}

async function fetchDetail(
  accessToken: string,
  id: string
): Promise<NsPaymentMethod> {
  const res = await fetch(`${RECORD_BASE}/paymentMethod/${id}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const pm = await getJson(res);

  const accountObj = pm?.account ?? null;
  const accountId = accountObj?.id ?? accountObj ?? null;
  const accountName = accountObj?.refName ?? accountObj?.name ?? null;
  const undep = pm?.undepFunds ?? pm?.undepfunds ?? null;

  return {
    id: String(pm.id ?? id),
    name: String(pm.name ?? pm.refName ?? pm?.fields?.name ?? "Payment Method"),
    isInactive: pm?.isInactive === true || pm?.isinactive === "T",
    undepositedDefault: undep === null ? null : Boolean(undep),
    defaultAccountId: accountId ? String(accountId) : null,
    defaultAccountName: accountName ?? null,
  };
}

async function fetchDetailsInBatches(
  accessToken: string,
  ids: string[],
  batchSize = 6
): Promise<NsPaymentMethod[]> {
  const out: NsPaymentMethod[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          return await fetchDetail(accessToken, id);
        } catch {
          return {
            id,
            name: "Payment Method",
            isInactive: false,
          } as NsPaymentMethod;
        }
      })
    );
    out.push(...results);
  }
  return out;
}

export async function listPaymentMethods(
  includeInactive = false
): Promise<{ success: boolean; methods: NsPaymentMethod[] }> {
  const token = await getValidToken();
  const ids = await listIds(token, includeInactive);
  const methods = await fetchDetailsInBatches(token, ids);
  // final filter for inactive unless explicitly included
  const filtered = includeInactive
    ? methods
    : methods.filter((m) => !m.isInactive);
  return { success: true, methods: filtered };
}
