// lib/versapay/makePaymentWithInstrument.ts
import axios from "axios";
import { resolveTokenForInstrument } from "../netsuite/getPaymentMethod";

const VP_API_BASE = `${process.env.VERSAPAY_BASE_URL}/api/v2`;

export type MakePaymentArgs = {
  sessionId: string;
  customerId: number | string;
  instrumentId: string;
  token?: string; //only for new payment method
  invoiceId: number | string;
  amount: number;
  capture?: boolean; // default true
  currency?: string; // default "USD"
  orderNumber?: string; // optional
  customerNumber?: string; // optional (ERP code)
  settlementToken?: string; // optional (Collaborative AR)
  billingAddress?: any; // optionally override defaults
  shippingAddress?: any; // optionally override defaults
};

export async function makePaymentWithInstrument(args: MakePaymentArgs) {
  console.log("Here", args);
  const {
    sessionId,
    customerId,
    instrumentId,
    token: directToken,
    invoiceId,
    amount,
    capture = true,
    currency = "USD",
    orderNumber,
    customerNumber,
    settlementToken,
    billingAddress,
    shippingAddress,
  } = args;

  if (
    !sessionId ||
    !customerId ||
    !invoiceId ||
    typeof amount !== "number" ||
    !(amount > 0)
  ) {
    throw new Error(
      "sessionId, customerId, instrumentId, invoiceId, and a positive numeric amount are required"
    );
  }

  if (!instrumentId && !directToken) {
    throw new Error("Provide either instrumentId or token");
  }
  let token = directToken;

  let tokenFamily;
  let tokenNamespace;
  if (!token && instrumentId) {
    console.log("Getting from resolver");
    const resolved = await resolveTokenForInstrument(
      Number(customerId),
      String(instrumentId)
    );
    token = resolved.token;
    tokenFamily = resolved.tokenFamily;
    tokenNamespace = resolved.tokenNamespace;
  }

  const payload = {
    gatewayAuthorization: {
      apiToken: process.env.VERSAPAY_API_TOKEN!,
      apiKey: process.env.VERSAPAY_API_KEY!,
    },
    customerNumber: customerNumber ?? String(customerId),
    orderNumber: orderNumber ?? `INV-${invoiceId}-${Date.now()}`,
    currency,

    billingAddress: {
      contactFirstName: "Web",
      contactLastName: "Buyer",
      companyName: "Example Co",
      address1: "123 Main St",
      city: "Boston",
      stateOrProvince: "MA",
      postCode: "02118",
      country: "US",
      email: "buyer@example.com",
      ...(billingAddress || {}),
    },
    shippingAddress: {
      contactFirstName: "Web",
      contactLastName: "Buyer",
      companyName: "Example Co",
      address1: "123 Main St",
      city: "Boston",
      stateOrProvince: "MA",
      postCode: "02118",
      country: "US",
      email: "buyer@example.com",
      ...(shippingAddress || {}),
    },

    lines: [
      {
        type: "Item",
        number: String(invoiceId),
        description: `Invoice ${invoiceId}`,
        price: amount,
        quantity: 1,
        discount: 0,
      },
    ],

    payment: {
      type: "creditCard",
      token,
      amount,
      capture,
      ...(settlementToken ? { settlementToken } : {}),
      ...(tokenFamily ? { tokenFamily } : {}),
      ...(tokenNamespace ? { tokenNamespace } : {}),
    },
  };

  const { data, status } = await axios.post(
    `${VP_API_BASE}/sessions/${sessionId}/sales`,
    payload,
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  //   const data = "test";
  //   const status = 201;
  //   console.log(" from payment", data, status);

  return { data, status: status === 201 ? 201 : 200 };
}
