import { NextResponse } from "next/server";
import { getInvoiceLineId } from "../../../../../lib/netsuite/getInvoiceLineId";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { invoiceId, salesOrderId, previousLineId } = body;

    if (!invoiceId || !salesOrderId || !previousLineId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const result = await getInvoiceLineId({
      invoiceId,
      salesOrderId,
      previousLineId,
    });

    return NextResponse.json({ result });
  } catch (err: any) {
    console.error(" Failed to fetch invoice line ID:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
