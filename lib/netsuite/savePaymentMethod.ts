import axios from "axios";
import { getValidToken } from "./token";

const PAYMENT_METHOD_ID = 10; //manual lookup from netsuite, id for payment token
const RESTLET_URL =
  "https://6518688.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=2437&deploy=1";
const accessToken = await getValidToken();

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
