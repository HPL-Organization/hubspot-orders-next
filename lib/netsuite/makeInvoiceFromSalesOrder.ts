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

export async function makeInvoiceFromSalesOrder(
  salesOrderInternalId: number | string,
  overrides?: Record<string, any>
): Promise<{ id: number | string; raw: any; mode: "empty-body" }> {
  const token = await getValidToken();
  const url = `${BASE_URL}/salesorder/${Number(
    salesOrderInternalId
  )}/!transform/invoice`;

  const res = await fetch(url, {
    method: "POST",
    headers: nsHeaders(token),
    body: overrides ? JSON.stringify(overrides) : null,
  });

  const txt = await res.text();
  let json: any;
  try {
    json = txt ? JSON.parse(txt) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const details = json?.["o:errorDetails"] ?? json ?? txt;
    const flatMsg = Array.isArray(details)
      ? details.map((d: any) => d?.detail || "").join("; ")
      : String(details || "");
    const looksLikeNoBillableLines =
      /line item/i.test(flatMsg) || /select.*line.*bill/i.test(flatMsg);

    if (looksLikeNoBillableLines) {
      throw new HttpError(
        "No billable lines on the Sales Order (everything billed or lines closed).",
        409,
        details
      );
    }
    throw new HttpError("NetSuite transform failed", res.status, details);
  }

  let id = json?.id ?? json?.internalId ?? json?.result?.id ?? null;

  if (!id) {
    const loc =
      res.headers.get("Location") || res.headers.get("location") || "";
    const m =
      loc.match(/\/invoice\/(\d+)(?:$|\?)/i) ||
      loc.match(/\/transaction\/(\d+)(?:$|\?)/i);
    if (m && m[1]) id = m[1];
  }

  if (!id) {
    throw new HttpError("Created invoice id not found on response", 502, {
      location: res.headers.get("Location"),
      bodyKeys: json ? Object.keys(json) : [],
      raw: json ?? txt,
    });
  }

  return { id, raw: json ?? {}, mode: "empty-body" };
}

//fetching line items to create invoice
// import { getValidToken } from "./token";

// const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
// const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/record/v1`;

// class HttpError extends Error {
//   status: number;
//   payload?: any;
//   constructor(message: string, status: number, payload?: any) {
//     super(message);
//     this.status = status;
//     this.payload = payload;
//   }
// }

// const nsHeaders = (token: string) => ({
//   Authorization: `Bearer ${token}`,
//   Accept: "application/json",
//   "Content-Type": "application/json",
//   Prefer: "return=representation",
// });

// async function postTransformInvoice(
//   salesOrderId: number | string,
//   body?: object
// ) {
//   const token = await getValidToken();
//   const url = `${BASE_URL}/salesorder/${Number(
//     salesOrderId
//   )}/!transform/invoice`;

//   const res = await fetch(url, {
//     method: "POST",
//     headers: nsHeaders(token),
//     body: body ? JSON.stringify(body) : null,
//   });

//   const txt = await res.text();
//   let json: any;
//   try {
//     json = txt ? JSON.parse(txt) : undefined;
//   } catch {}

//   if (!res.ok) {
//     const details = json?.["o:errorDetails"] ?? json ?? txt;
//     throw new HttpError("NetSuite transform failed", res.status, details);
//   }
//   return json;
// }

// interface SOItemLine {
//   orderLine: number;
//   itemId?: number | string | null;
//   toBill: number;
//   isClosed: boolean;
// }

// async function fetchSalesOrderLines(salesOrderId: number | string) {
//   const token = await getValidToken();

//   const url = `${BASE_URL}/salesorder/${Number(salesOrderId)}/item?limit=1000`;

//   const res = await fetch(url, { headers: nsHeaders(token) });

//   const txt = await res.text();
//   let data: any;
//   try {
//     data = txt ? JSON.parse(txt) : {};
//   } catch {
//     data = {};
//   }

//   if (!res.ok) {
//     const payload = data?.["o:errorDetails"] ?? data ?? txt;
//     throw new HttpError(
//       "Failed to fetch sales order lines",
//       res.status,
//       payload
//     );
//   }

//   const items: any[] = Array.isArray(data?.items) ? data.items : data;

//   return items.map((line: any, idx: number) => {
//     const orderLine = Number(
//       line.line ?? line.orderLine ?? line.lineSequenceNumber ?? idx + 1
//     );
//     const quantity = Number(line.quantity ?? line.qty ?? 0);
//     const quantityBilled = Number(
//       line.quantitybilled ?? line.quantityBilled ?? 0
//     );
//     const isClosed = Boolean(line.isclosed ?? line.isClosed ?? false);
//     const itemId = line?.item?.id ?? line?.item?.internalId ?? null;

//     return {
//       orderLine,
//       itemId,
//       toBill: Math.max(0, quantity - quantityBilled),
//       isClosed,
//     };
//   });
// }

// export async function makeInvoiceFromSalesOrder(
//   salesOrderInternalId: number | string,
//   overrides?: Record<string, any>
// ): Promise<{
//   id: number | string;
//   raw: any;
//   mode: "empty-body" | "with-lines";
// }> {
//   try {
//     const result = await postTransformInvoice(salesOrderInternalId, overrides);
//     return { id: result?.id, raw: result, mode: "empty-body" };
//   } catch (e) {
//     const err = e as HttpError;
//     const details = Array.isArray(err?.payload) ? err.payload : [];
//     const noLines = details.some((d) =>
//       String(d?.detail || "")
//         .toLowerCase()
//         .includes("line item")
//     );
//     if (!noLines) throw err;

//     const lines = await fetchSalesOrderLines(salesOrderInternalId);
//     const itemsToBill = lines
//       .filter((l) => !l.isClosed && l.toBill > 0)
//       .map((l) => ({ orderLine: l.orderLine, quantity: l.toBill }));

//     if (itemsToBill.length === 0) {
//       throw new HttpError("No billable lines found on the sales order", 409);
//     }

//     const body = { item: { items: itemsToBill }, ...(overrides || {}) };
//     const result = await postTransformInvoice(salesOrderInternalId, body);
//     return { id: result?.id, raw: result, mode: "with-lines" };
//   }
// }
