import { NextResponse } from "next/server";
import { voidSale } from "../../../../../lib/versapay/voidSale";

export async function POST(req: Request) {
  try {
    const { transactionId, amount, amountCents } = await req.json();

    if (!transactionId) {
      return NextResponse.json(
        { error: "transactionId is required" },
        { status: 400 }
      );
    }

    const result = await voidSale({ transactionId, amount, amountCents });
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error("Versapay void error:", err?.response?.data || err);
    return NextResponse.json(
      { error: err?.message || "Failed to void transaction" },
      { status: 500 }
    );
  }
}
