import axios from "axios";
import { getValidToken } from "./token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";

const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const PAYMENT_METHOD_ID = 10; //manual lookup from netsuite, id for payment token
const RESTLET_URL = `https://${NETSUITE_ACCOUNT_ID}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=2437&deploy=1`;

export async function savePaymentMethod(
  customerInternalId: number,
  token: string,
  opts?: {
    cardNameOnCard?: string;
    tokenExpirationDate?: string; // "MM/YYYY" or "YYYY-MM-DD"
    accountNumberLastFour?: string;
    accountType?: string;
  }
) {
  const accessToken = await getValidToken();
  const body: Record<string, any> = {
    customerId: Number(customerInternalId),
    paymentMethodId: PAYMENT_METHOD_ID,
    token,
    tokenFamilyLabel: "Versapay",
  };

  if (opts?.cardNameOnCard) body.cardNameOnCard = opts.cardNameOnCard;
  if (opts?.tokenExpirationDate)
    body.tokenExpirationDate = opts.tokenExpirationDate;

  if (opts?.accountNumberLastFour)
    body.accountNumberLastFour = opts.accountNumberLastFour;
  if (opts?.accountType) body.accountType = opts.accountType;

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
    data = { raw: text };
  }

  if (!res.ok || data?.error) {
    const message =
      data?.message ||
      data?.error ||
      data?.details ||
      `HTTP ${res.status}: ${text}`;
    throw new Error(`NetSuite RESTlet error: ${message}`);
  }

  return data; // { success: true, paymentCardTokenId: <id> }
}
