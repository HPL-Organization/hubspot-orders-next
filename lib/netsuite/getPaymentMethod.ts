import { getValidToken } from "./token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";

const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;

const RESTLET_URL = `https://${NETSUITE_ACCOUNT_ID}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=2438&deploy=1`;
// "https://6518688.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=2438&deploy=1";

export type PaymentInstrument = {
  id: string;
  paymentMethod: string | null;
  brand: string | null;
  last4: string | null;
  expiry: string | null;
  tokenFamily: string | null;
  tokenNamespace: string | null;
  loadError?: string;
};

export type GetPaymentMethodResponse = {
  success: boolean;
  count?: number;
  instruments?: PaymentInstrument[];
  message?: string;
  sublistId?: string;
  idField?: string;
  truncated?: boolean;
};

type TokenEntry = {
  token: string;
  tokenFamily: string | null;
  tokenNamespace: string | null;
};
const tokenStore = new Map<string, TokenEntry>(); // key = `${customerId}:${instrumentId}`
const keyFor = (customerId: number, instrumentId: string) =>
  `${customerId}:${instrumentId}`;

function seedTokens(customerId: number, instruments: any[]) {
  for (const i of instruments || []) {
    if (i?.id && i?.token) {
      tokenStore.set(keyFor(customerId, String(i.id)), {
        token: String(i.token),
        tokenFamily: i.tokenFamily ?? null,
        tokenNamespace: i.tokenNamespace ?? null,
      });
    }
  }
}

export async function getPaymentMethod(
  customerInternalId: number
): Promise<GetPaymentMethodResponse> {
  const accessToken = await getValidToken();

  // One call to build the masked list;
  const body = {
    customerId: Number(customerInternalId),
    includeTokens: true,
  };

  const res = await fetch(RESTLET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    return { success: false, message: `Parse error: ${text}` };
  }

  if (!res.ok || data?.error || data?.success === false) {
    const message =
      data?.message ||
      data?.error ||
      data?.details ||
      `HTTP ${res.status}: ${text}`;
    return { success: false, message };
  }

  const instruments = Array.isArray(data.instruments) ? data.instruments : [];

  seedTokens(Number(customerInternalId), instruments);

  const masked: PaymentInstrument[] = instruments.map((i: any) => {
    const { token, ...rest } = i || {};
    return rest as PaymentInstrument;
  });

  return {
    ...data,
    instruments: masked,
  } as GetPaymentMethodResponse;
}

/**
 * Stateless resolver: if token not in memory, do a fresh NetSuite call
 * with includeTokens=true and extract the token for the given instrument.
 */
export async function resolveTokenForInstrument(
  customerId: number,
  instrumentId: string
): Promise<{
  token: string;
  tokenFamily: string | null;
  tokenNamespace: string | null;
}> {
  const k = keyFor(customerId, String(instrumentId));
  const cached = tokenStore.get(k);
  if (cached?.token) {
    return cached;
  }

  // Fallback:
  const accessToken = await getValidToken();

  const res = await fetch(RESTLET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      customerId: Number(customerId),
      includeTokens: true,
    }),
  });

  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Parse error: ${text}`);
  }

  if (!res.ok || data?.success === false) {
    const msg = data?.message || data?.error || `HTTP ${res.status}: ${text}`;
    throw new Error(msg);
  }

  const instruments = Array.isArray(data.instruments) ? data.instruments : [];
  const match = instruments.find(
    (i: any) => String(i?.id) === String(instrumentId)
  );

  if (!match?.token) {
    throw new Error("Token not found for selected instrument.");
  }

  tokenStore.set(k, {
    token: String(match.token),
    tokenFamily: match.tokenFamily ?? null,
    tokenNamespace: match.tokenNamespace ?? null,
  });

  return {
    token: String(match.token),
    tokenFamily: match.tokenFamily ?? null,
    tokenNamespace: match.tokenNamespace ?? null,
  };
}

export function clearCustomerTokens(customerId: number) {
  for (const k of tokenStore.keys()) {
    if (k.startsWith(`${customerId}:`)) tokenStore.delete(k);
  }
}
