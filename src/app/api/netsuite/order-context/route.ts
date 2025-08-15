import { NextRequest, NextResponse } from "next/server";
import { getSalesOrderContextById } from "../../../../../lib/netsuite/getPaymentDetailsVersapay/getSalesOrderContext";

export async function POST(req: NextRequest) {
  try {
    const { netsuiteInternalId } = await req.json();
    if (!netsuiteInternalId) {
      return NextResponse.json(
        { error: "netsuiteInternalId is required" },
        { status: 400 }
      );
    }
    const data = await getSalesOrderContextById(Number(netsuiteInternalId));
    return NextResponse.json(data, { status: 200 });
  } catch (err: any) {
    console.error("order-context error", err?.response?.data || err);
    return NextResponse.json(
      { error: "Failed to fetch order context", details: err?.message || err },
      { status: 500 }
    );
  }
}
