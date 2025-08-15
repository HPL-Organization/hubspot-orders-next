import axios from "axios";

const GATEWAY_BASE = (process.env.VERSAPAY_GATEWAY_BASE || "").replace(
  /\/$/,
  ""
);
const API_TOKEN = process.env.VERSAPAY_API_TOKEN!;
const API_KEY = process.env.VERSAPAY_API_KEY!;

/**
 * Void a prior transaction
 */
export async function voidSale(params: {
  transactionId: string;
  amount?: number; // dollars (optional)
  amountCents?: number;
}) {
  if (!GATEWAY_BASE) throw new Error("Missing VERSAPAY_GATEWAY_BASE");
  if (!API_TOKEN || !API_KEY)
    throw new Error("Missing VERSAPAY_API_TOKEN or VERSAPAY_API_KEY");
  if (!params?.transactionId) throw new Error("transactionId is required");

  const payload: any = { transaction: params.transactionId };
  if (typeof params.amountCents === "number") {
    payload.amount_cents = Math.round(params.amountCents);
  } else if (typeof params.amount === "number") {
    payload.amount_cents = Math.round(params.amount * 100);
  }

  const basic = Buffer.from(`${API_TOKEN}:${API_KEY}`).toString("base64");

  try {
    const resp = await axios.post(
      `${GATEWAY_BASE}/api/gateway/v1/orders/void`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Basic ${basic}`,
        },
        // timeout: 10000,
      }
    );
    // console.log("data from void ", resp, resp.data);
    return resp.data;
  } catch (err: any) {
    const msg =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Void failed";
    const status = err?.response?.status;
    throw new Error(`${status ? `HTTP ${status}: ` : ""}${msg}`);
  }
}
