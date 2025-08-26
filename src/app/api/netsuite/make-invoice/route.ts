import { NextResponse } from "next/server";
import { makeInvoiceFromSalesOrder } from "../../../../../lib/netsuite/makeInvoiceFromSalesOrder";

export async function POST(req: Request) {
  try {
    const { salesOrderInternalId, overrides } = await req.json();
    if (!salesOrderInternalId) {
      return NextResponse.json(
        { error: "Missing salesOrderInternalId" },
        { status: 400 }
      );
    }

    const result = await makeInvoiceFromSalesOrder(
      salesOrderInternalId,
      overrides
    );
    return NextResponse.json(
      {
        ok: true,
        invoiceInternalId: result.id,
        mode: result.mode,
        invoice: result.raw,
      },
      { status: 200 }
    );
  } catch (e) {
    const err = e as { status?: number; message?: string; payload?: any };
    const status = typeof err?.status === "number" ? err.status : 500;
    return NextResponse.json(
      {
        error: "Failed to create invoice",
        details: String(err?.message || e),
        payload: err?.payload,
      },
      { status }
    );
  }
}
