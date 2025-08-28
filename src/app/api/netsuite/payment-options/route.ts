import { NextResponse } from "next/server";
import { listPaymentOptionsForMethod } from "../../../../../lib/netsuite/listPaymentOptions";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const pmId = url.searchParams.get("paymentMethodId");
    if (!pmId) {
      return NextResponse.json(
        { success: false, message: "paymentMethodId is required" },
        { status: 400 }
      );
    }
    const options = await listPaymentOptionsForMethod(Number(pmId));
    return NextResponse.json({ success: true, options }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      {
        success: false,
        message: e?.message || "Failed to list payment options",
      },
      { status: 500 }
    );
  }
}
