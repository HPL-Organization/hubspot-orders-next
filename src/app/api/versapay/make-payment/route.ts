// app/api/versapay/make-payment/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makePaymentWithInstrument } from "../../../../../lib/versapay/makePaymentWithInstrument";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { data, status } = await makePaymentWithInstrument(body);
    return NextResponse.json(data, { status });
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    const details = err?.response?.data ?? {
      message: err?.message || "Unknown error",
    };
    return NextResponse.json(
      { success: false, message: "Versapay sale failed", details },
      { status }
    );
  }
}
