import { NextRequest, NextResponse } from "next/server";
import { getSalesOrderLines } from "../../../../../lib/netsuite/getPaymentDetailsVersapay/getSalesOrderLines";

export async function POST(req: NextRequest) {
  try {
    const { netsuiteInternalId } = await req.json();
    if (!netsuiteInternalId) {
      return NextResponse.json(
        { error: "netsuiteInternalId is required" },
        { status: 400 }
      );
    }
    const lines = await getSalesOrderLines(Number(netsuiteInternalId));
    return NextResponse.json({ lines }, { status: 200 });
  } catch (err: any) {
    console.error("order-lines error", err?.response?.data || err);
    return NextResponse.json(
      { error: "Failed to fetch order lines", details: err?.message || err },
      { status: 500 }
    );
  }
}
