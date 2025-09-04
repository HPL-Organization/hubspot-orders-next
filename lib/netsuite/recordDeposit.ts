// lib/netsuite/recordDeposit.ts
import { getValidToken } from "./token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/record/v1`;

class HttpError extends Error {
  status: number;
  payload?: any;
  constructor(message: string, status: number, payload?: any) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

const nsHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  "Content-Type": "application/json",
  Prefer: "return=representation",
});

export type DepositParams = {
  amount: number;
  undepFunds?: boolean; // default: true (Undeposited Funds)
  accountId?: number; // required if undepFunds === false (bank acct)
  paymentMethodId?: number; // optional
  paymentOptionId?: number; // optional
  trandate?: string; // YYYY-MM-DD
  memo?: string;
  externalId?: string;
  exchangeRate?: number;
  extraFields?: Record<string, any>;
};

// ---------- helpers ----------
function extractIdFromLocation(loc: string | null) {
  if (!loc) return null;
  const m =
    loc.match(/\/customerdeposit\/(\d+)(?:$|\?)/i) ||
    loc.match(/\/transaction\/(\d+)(?:$|\?)/i);
  return m?.[1] ?? null;
}

async function fetchSalesOrderEntityId(soId: number | string): Promise<number> {
  const token = await getValidToken();
  const res = await fetch(
    `${BASE_URL}/salesorder/${Number(soId)}?fields=entity`,
    { headers: nsHeaders(token) }
  );
  const txt = await res.text();
  let json: any;
  try {
    json = txt ? JSON.parse(txt) : undefined;
  } catch {}
  if (!res.ok) {
    const details = json?.["o:errorDetails"] ?? json ?? txt;
    throw new HttpError("Failed to fetch SO entity", res.status, details);
  }
  const entityId = Number(json?.entity?.id);
  if (!entityId) throw new HttpError("Sales Order has no entity", 409, json);
  return entityId;
}

async function transformSalesOrderToCustomerDeposit(
  soId: number | string,
  body: Record<string, any>
): Promise<{ id: number | string; raw: any }> {
  const token = await getValidToken();
  const res = await fetch(
    `${BASE_URL}/salesorder/${Number(soId)}/!transform/customerdeposit`,
    { method: "POST", headers: nsHeaders(token), body: JSON.stringify(body) }
  );

  const txt = await res.text();
  let json: any;
  try {
    json = txt ? JSON.parse(txt) : undefined;
  } catch {}

  if (!res.ok) {
    const errCode =
      json?.["o:errorCode"] ?? json?.errorCode ?? json?.code ?? undefined;

    const detailsArr = Array.isArray(json?.["o:errorDetails"])
      ? json["o:errorDetails"].map(
          (d: any) => d?.message || d?.detail || JSON.stringify(d)
        )
      : [];

    const primary =
      json?.title ||
      json?.message ||
      json?.detail ||
      res.statusText ||
      "Unknown error";

    const extra =
      detailsArr.length > 0
        ? ` | Details: ${detailsArr.join(" | ")}`
        : txt && !json
        ? ` | Raw: ${txt.substring(0, 500)}`
        : "";

    const pretty = `Transform to customerdeposit failed${
      errCode ? ` [${errCode}]` : ""
    }: ${primary}${extra}`;

    const details = json?.["o:errorDetails"] ?? json ?? txt;
    console.error(pretty, { status: res.status, soId, details });
    throw new HttpError(pretty, res.status, details);
  }

  let id = json?.id ?? json?.internalId ?? json?.result?.id ?? null;
  if (!id) {
    id = extractIdFromLocation(
      res.headers.get("Location") || res.headers.get("location")
    );
  }
  if (!id) {
    throw new HttpError("Customer deposit created but id missing", 502, {
      location: res.headers.get("Location") || res.headers.get("location"),
      bodyKeys: json ? Object.keys(json) : [],
      raw: json ?? txt,
    });
  }

  console.info("Customer deposit created", { soId, id });
  return { id, raw: json ?? {} };
}

async function createCustomerDepositDirect(body: Record<string, any>) {
  const token = await getValidToken();
  const res = await fetch(`${BASE_URL}/customerdeposit`, {
    method: "POST",
    headers: nsHeaders(token),
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let json: any;
  try {
    json = txt ? JSON.parse(txt) : undefined;
  } catch {}
  if (!res.ok) {
    const details = json?.["o:errorDetails"] ?? json ?? txt;
    throw new HttpError("Create customerdeposit failed", res.status, details);
  }
  let id = json?.id ?? json?.internalId ?? json?.result?.id ?? null;
  if (!id)
    id = extractIdFromLocation(
      res.headers.get("Location") || res.headers.get("location")
    );
  if (!id) {
    throw new HttpError("Customer deposit created but id missing", 502, {
      location: res.headers.get("Location"),
      bodyKeys: json ? Object.keys(json) : [],
      raw: json ?? txt,
    });
  }
  return { id, raw: json ?? {} };
}

async function patchCustomerDepositHeader(
  depositId: number | string,
  body: Record<string, any>
) {
  const token = await getValidToken();
  const res = await fetch(`${BASE_URL}/customerdeposit/${Number(depositId)}`, {
    method: "PATCH",
    headers: nsHeaders(token),
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let json: any;
  try {
    json = txt ? JSON.parse(txt) : undefined;
  } catch {}
  if (!res.ok) {
    const details = json?.["o:errorDetails"] ?? json ?? txt;
    throw new HttpError(
      "Failed to update customer deposit header",
      res.status,
      details
    );
  }
  return json ?? {};
}

async function fetchCustomerDeposit(
  depositId: number | string,
  fields = "id,customer,salesOrder,payment,undepFunds,account,trandate,memo,externalId"
) {
  const token = await getValidToken();
  const res = await fetch(
    `${BASE_URL}/customerdeposit/${Number(
      depositId
    )}?fields=${encodeURIComponent(fields)}`,
    { headers: nsHeaders(token) }
  );
  const txt = await res.text();
  let json: any;
  try {
    json = txt ? JSON.parse(txt) : undefined;
  } catch {}
  if (!res.ok) {
    const details = json?.["o:errorDetails"] ?? json ?? txt;
    throw new HttpError(
      "Failed to fetch customer deposit",
      res.status,
      details
    );
  }
  return json ?? {};
}

export async function recordDepositForSalesOrder(
  salesOrderInternalId: number | string,
  params: DepositParams
): Promise<{ id: number | string; raw: any; mode: "transform" | "direct" }> {
  const {
    amount,
    undepFunds = true,
    accountId,
    paymentMethodId,
    paymentOptionId,
    trandate,
    memo,
    externalId,
    exchangeRate,
    extraFields = {},
  } = params;

  if (typeof amount !== "number" || !isFinite(amount) || amount <= 0) {
    throw new HttpError("Amount must be a positive number.", 400);
  }
  if (!undepFunds && !accountId) {
    throw new HttpError(
      "When undepFunds is false you must provide 'accountId'.",
      400
    );
  }

  let created: { id: number | string; raw: any; mode: "transform" | "direct" };
  try {
    const body: Record<string, any> = {
      payment: amount,
      undepFunds,
      ...(accountId ? { account: { id: Number(accountId) } } : {}),
      ...(paymentOptionId
        ? { paymentOption: { id: Number(paymentOptionId) } }
        : {}),
      ...(paymentMethodId && !paymentOptionId
        ? { paymentMethod: { id: Number(paymentMethodId) } }
        : {}),
      ...(trandate ? { trandate } : {}),
      ...(memo ? { memo } : {}),
      ...(externalId ? { externalId } : {}),
      ...(typeof exchangeRate === "number" ? { exchangeRate } : {}),
      ...extraFields,
    };
    const { id, raw } = await transformSalesOrderToCustomerDeposit(
      salesOrderInternalId,
      body
    );
    created = { id, raw, mode: "transform" };
  } catch {
    const customerId = await fetchSalesOrderEntityId(salesOrderInternalId);
    const createBody: Record<string, any> = {
      customer: { id: customerId },
      salesOrder: { id: Number(salesOrderInternalId) },
      payment: amount,
      undepFunds,
      ...(accountId ? { account: { id: Number(accountId) } } : {}),
      ...(paymentOptionId
        ? { paymentOption: { id: Number(paymentOptionId) } }
        : {}),
      ...(paymentMethodId && !paymentOptionId
        ? { paymentMethod: { id: Number(paymentMethodId) } }
        : {}),
      ...(trandate ? { trandate } : {}),
      ...(memo ? { memo } : {}),
      ...(externalId ? { externalId } : {}),
      ...(typeof exchangeRate === "number" ? { exchangeRate } : {}),
      ...extraFields,
    };
    const { id, raw } = await createCustomerDepositDirect(createBody);
    created = { id, raw, mode: "direct" };
  }

  await patchCustomerDepositHeader(created.id, {
    salesOrder: { id: Number(salesOrderInternalId) },
  });

  const final = await fetchCustomerDeposit(created.id);
  return { id: created.id, raw: final, mode: created.mode };
}
