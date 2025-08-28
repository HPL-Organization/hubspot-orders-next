// src/app/api/netsuite/offline-payment-methods/route.ts
import { NextResponse } from "next/server";
import { listPaymentMethods } from "../../../../../lib/netsuite/getOfflinePaymentMethod";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeInactive = url.searchParams.get("includeInactive") === "1";
    const data = await listPaymentMethods(includeInactive);
    return NextResponse.json(data, { status: 200 });
  } catch (err: any) {
    console.error("get-offline-payment-method error:", err?.message || err);
    return NextResponse.json(
      {
        success: false,
        message: err?.message || "Failed to fetch payment methods",
      },
      { status: 500 }
    );
  }
}
