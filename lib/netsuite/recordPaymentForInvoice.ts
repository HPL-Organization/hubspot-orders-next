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

export type PaymentParams = {
  amount: number;
  undepFunds?: boolean;
  accountId?: number;
  paymentMethodId?: number;
  paymentOptionId?: number;
  trandate?: string; // "YYYY-MM-DD"
  memo?: string;
  externalId?: string; //  VersaPay id
  exchangeRate?: number;
  extraFields?: Record<string, any>;
};

// ---------- helpers ----------
function extractIdFromLocation(loc: string | null) {
  if (!loc) return null;
  const m =
    loc.match(/\/customerpayment\/(\d+)(?:$|\?)/i) ||
    loc.match(/\/transaction\/(\d+)(?:$|\?)/i);
  return m?.[1] ?? null;
}

async function fetchInvoiceEntityId(
  invoiceId: number | string
): Promise<number> {
  const token = await getValidToken();
  const res = await fetch(
    `${BASE_URL}/invoice/${Number(invoiceId)}?fields=entity`,
    { headers: nsHeaders(token) }
  );
  const txt = await res.text();
  let json: any;
  try {
    json = txt ? JSON.parse(txt) : undefined;
  } catch {}
  if (!res.ok) {
    const details = json?.["o:errorDetails"] ?? json ?? txt;
    throw new HttpError("Failed to fetch invoice entity", res.status, details);
  }
  const entityId = Number(json?.entity?.id);
  if (!entityId) throw new HttpError("Invoice has no entity", 409, json);
  return entityId;
}

async function transformInvoiceToCustomerPayment(
  invoiceId: number | string,
  body: Record<string, any>
): Promise<{ id: number | string; raw: any }> {
  const token = await getValidToken();
  const res = await fetch(
    `${BASE_URL}/invoice/${Number(invoiceId)}/!transform/customerpayment`,
    { method: "POST", headers: nsHeaders(token), body: JSON.stringify(body) }
  );
  const txt = await res.text();
  let json: any;
  try {
    json = txt ? JSON.parse(txt) : undefined;
  } catch {}
  if (!res.ok) {
    const details = json?.["o:errorDetails"] ?? json ?? txt;
    throw new HttpError(
      "Transform to customerpayment failed",
      res.status,
      details
    );
  }
  let id = json?.id ?? json?.internalId ?? json?.result?.id ?? null;
  if (!id)
    id = extractIdFromLocation(
      res.headers.get("Location") || res.headers.get("location")
    );
  if (!id) {
    throw new HttpError("Customer payment created but id missing", 502, {
      location: res.headers.get("Location"),
      bodyKeys: json ? Object.keys(json) : [],
      raw: json ?? txt,
    });
  }
  return { id, raw: json ?? {} };
}

async function createCustomerPaymentDirect(body: Record<string, any>) {
  const token = await getValidToken();
  const res = await fetch(`${BASE_URL}/customerpayment`, {
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
    throw new HttpError("Create customerpayment failed", res.status, details);
  }
  let id = json?.id ?? json?.internalId ?? json?.result?.id ?? null;
  if (!id)
    id = extractIdFromLocation(
      res.headers.get("Location") || res.headers.get("location")
    );
  if (!id) {
    throw new HttpError("Customer payment created but id missing", 502, {
      location: res.headers.get("Location"),
      bodyKeys: json ? Object.keys(json) : [],
      raw: json ?? txt,
    });
  }
  return { id, raw: json ?? {} };
}

async function patchCustomerPaymentHeader(
  paymentId: number | string,
  body: Record<string, any>
) {
  const token = await getValidToken();
  const res = await fetch(`${BASE_URL}/customerpayment/${Number(paymentId)}`, {
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
      "Failed to update customer payment header",
      res.status,
      details
    );
  }
  return json ?? {};
}

async function getPaymentApplyLines(paymentId: number | string) {
  const token = await getValidToken();
  const parseFromLinks = (links?: any[]) => {
    const href = String(links?.[0]?.href || "");
    const m = href.match(/\/apply\/doc=(\d+),line=(\d+)/i);
    return m
      ? { docId: Number(m[1]), line: Number(m[2]), href }
      : { docId: null, line: null, href: null };
  };

  {
    const res = await fetch(
      `${BASE_URL}/customerpayment/${Number(
        paymentId
      )}/apply?fields=doc,line,links,apply,amount`,
      { headers: nsHeaders(token) }
    );
    const txt = await res.text();
    let json: any;
    try {
      json = txt ? JSON.parse(txt) : undefined;
    } catch {}
    if (res.ok) {
      const rows = Array.isArray(json?.items) ? json.items : json;
      return (Array.isArray(rows) ? rows : []).map((it: any) => {
        const docId =
          it?.doc?.id != null
            ? Number(it.doc.id)
            : parseFromLinks(it?.links).docId;
        const line =
          it?.line != null ? Number(it.line) : parseFromLinks(it?.links).line;
        const href =
          parseFromLinks(it?.links).href || it?.links?.[0]?.href || null;
        return { docId, line, href, raw: it };
      });
    }
  }

  {
    const res = await fetch(
      `${BASE_URL}/customerpayment/${Number(paymentId)}/apply`,
      {
        headers: nsHeaders(token),
      }
    );
    const txt = await res.text();
    let json: any;
    try {
      json = txt ? JSON.parse(txt) : undefined;
    } catch {}
    if (res.ok) {
      const rows = Array.isArray(json?.items) ? json.items : json;
      return (Array.isArray(rows) ? rows : []).map((it: any) => {
        const parsed = parseFromLinks(it?.links);
        return {
          docId: parsed.docId,
          line: parsed.line,
          href: parsed.href,
          raw: it,
        };
      });
    }
  }

  const res = await fetch(
    `${BASE_URL}/customerpayment/${Number(paymentId)}?expand=apply`,
    {
      headers: nsHeaders(token),
    }
  );
  const txt = await res.text();
  let json: any;
  try {
    json = txt ? JSON.parse(txt) : undefined;
  } catch {}
  if (!res.ok) {
    throw new HttpError(
      "Failed to fetch payment apply sublist",
      res.status,
      json ?? txt
    );
  }
  const rows = Array.isArray(json?.apply?.items) ? json.apply.items : [];
  return rows.map((it: any) => {
    const docId =
      it?.doc?.id != null ? Number(it.doc.id) : parseFromLinks(it?.links).docId;
    const line =
      it?.line != null ? Number(it.line) : parseFromLinks(it?.links).line;
    const href = parseFromLinks(it?.links).href || it?.links?.[0]?.href || null;
    return { docId, line, href, raw: it };
  });
}

async function findApplyRowHrefForInvoice(
  paymentId: number | string,
  invoiceId: number | string
): Promise<string> {
  const items = await getPaymentApplyLines(paymentId);
  const target = items.find(
    (it) =>
      it?.docId != null && Number(it.docId) === Number(invoiceId) && it?.href
  );
  if (!target) {
    throw new HttpError("Invoice not found in payment apply list", 404, {
      paymentId,
      invoiceId,
      items: items.map((i) => ({ docId: i.docId, line: i.line, href: i.href })),
    });
  }
  return String(target.href);
}

export async function recordPaymentForInvoice(
  invoiceInternalId: number | string,
  params: PaymentParams
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
      "When undepFunds is false you must provide a bank 'accountId'.",
      400
    );
  }

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

    const { id, raw } = await transformInvoiceToCustomerPayment(
      invoiceInternalId,
      body
    );

    if (paymentOptionId) {
      await patchCustomerPaymentHeader(id, {
        paymentOption: { id: Number(paymentOptionId) },
      });
    }

    return { id, raw, mode: "transform" };
  } catch (e: any) {
    const payload = e?.payload ?? e;
    const msg = JSON.stringify(payload).toLowerCase();

    const shouldFallback =
      msg.includes("cannot apply more than your total payments") ||
      msg.includes("apply more than your total payments") ||
      msg.includes("nothing to apply") ||
      msg.includes("invalid sublist") ||
      msg.includes("line item operation");

    if (!shouldFallback) {
      throw e;
    }
  }

  const customerId = await fetchInvoiceEntityId(invoiceInternalId);

  const createBody: Record<string, any> = {
    customer: { id: customerId },
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
    autoApply: false,
    ...extraFields,
  };

  const { id: paymentId, raw: createdRaw } = await createCustomerPaymentDirect(
    createBody
  );

  if (paymentOptionId) {
    await patchCustomerPaymentHeader(paymentId, {
      paymentOption: { id: Number(paymentOptionId) },
    });
  }

  const rowHref = await findApplyRowHrefForInvoice(
    paymentId,
    invoiceInternalId
  );
  const token = await getValidToken();
  const patchRes = await fetch(rowHref, {
    method: "PATCH",
    headers: nsHeaders(token),
    body: JSON.stringify({ apply: true, amount }),
  });
  const patchTxt = await patchRes.text();
  let patchJson: any;
  try {
    patchJson = patchTxt ? JSON.parse(patchTxt) : undefined;
  } catch {}
  if (!patchRes.ok) {
    const details = patchJson?.["o:errorDetails"] ?? patchJson ?? patchTxt;
    throw new HttpError(
      "Failed to apply payment to invoice",
      patchRes.status,
      details
    );
  }

  return { id: paymentId, raw: patchJson ?? createdRaw, mode: "direct" };
}
