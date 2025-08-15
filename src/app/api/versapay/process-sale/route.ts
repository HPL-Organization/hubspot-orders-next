import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

const VP_API_BASE = `${process.env.VERSAPAY_BASE_URL}/api/v2`;
// e.g. VERSAPAY_BASE_URL=https://ecommerce-api-uat.versapay.com for testing

export async function POST(req: NextRequest) {
  try {
    const {
      sessionId, // required: the same session you used for the iframe
      token, // required: result.token from client.onApproval(...)
      amount, // required: number
      capture = true, // true=capture, false=authorize
      orderNumber, // optional: if omitted we'll generate one
      currency = "USD", // "USD", "CAD", etc
      customerNumber, // optional: ERP customer code if you have it
      settlementToken, // optional: MID token for Collaborative AR, if you use it
    } = await req.json();

    if (!sessionId || !token || typeof amount !== "number") {
      return NextResponse.json(
        { error: "sessionId, token, and amount are required" },
        { status: 400 }
      );
    }

    const payload = {
      gatewayAuthorization: {
        apiToken: process.env.VERSAPAY_API_TOKEN!,
        apiKey: process.env.VERSAPAY_API_KEY!,
      },
      customerNumber: customerNumber ?? "CUST-TEST",
      orderNumber: orderNumber ?? `WEB-${Date.now()}`,
      currency,
      // Minimal/dummy addresses (replace with real ones later)
      billingAddress: {
        contactFirstName: "Test",
        contactLastName: "Buyer",
        companyName: "Example Co",
        address1: "123 Main St",
        city: "Boston",
        stateOrProvince: "MA",
        postCode: "02118",
        country: "US",
        email: "buyer@example.com",
      },
      shippingAddress: {
        contactFirstName: "Test",
        contactLastName: "Buyer",
        companyName: "Example Co",
        address1: "123 Main St",
        city: "Boston",
        stateOrProvince: "MA",
        postCode: "02118",
        country: "US",
        email: "buyer@example.com",
      },
      // Minimal single line (price * quantity should roughly match amount you charge)
      lines: [
        {
          type: "Item",
          number: "SKU-TEST",
          description: "Test Item",
          price: amount,
          quantity: 1,
          discount: 0,
        },
      ],
      // One-step order + payment using the token you just received
      payment: {
        type: "creditCard",
        token,
        amount,
        capture,
        ...(settlementToken ? { settlementToken } : {}),
      },
      // You can also do multi-payment via `payments: [...]` instead of `payment`
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

    return NextResponse.json(data, { status: status === 201 ? 201 : 200 });
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    const details = err?.response?.data ?? { message: err.message };
    return NextResponse.json(
      { error: "Versapay sale failed", details },
      { status }
    );
  }
}
