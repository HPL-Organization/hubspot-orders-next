import { NextResponse } from "next/server";
import { recordPaymentForInvoice } from "../../../../../lib/netsuite/recordPaymentForInvoice";

export async function POST(req: Request) {
  try {
    const {
      invoiceInternalId,
      amount,
      undepFunds = true,
      accountId,
      paymentMethodId,
      paymentOptionId,
      trandate,
      memo,
      externalId,
      exchangeRate,
      extraFields,
    } = await req.json();

    if (!invoiceInternalId || typeof amount !== "number") {
      return NextResponse.json(
        { error: "Missing invoiceInternalId or amount" },
        { status: 400 }
      );
    }

    const result = await recordPaymentForInvoice(invoiceInternalId, {
      amount,
      undepFunds,
      accountId,
      paymentMethodId,
      paymentOptionId,
      trandate,
      memo,
      externalId,
      exchangeRate,
      extraFields,
    });

    return NextResponse.json(
      {
        ok: true,
        mode: result.mode,
        paymentInternalId: result.id,
        payment: result.raw,
      },
      { status: 200 }
    );
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500;
    return NextResponse.json(
      {
        error: "Failed to record payment",
        details: String(e?.message || e),
        payload: e?.payload,
      },
      { status }
    );
  }
}
