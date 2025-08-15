import { NextRequest, NextResponse } from "next/server";
import { getSalesOrderContextById } from "../../../../../lib/netsuite/getPaymentDetailsVersapay/getSalesOrderContext";
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

    const ctx = await getSalesOrderContextById(Number(netsuiteInternalId));
    const lines = await getSalesOrderLines(Number(netsuiteInternalId));

    const vpLines = lines.map((l) => ({
      type: "Item",
      number: l.sku,
      description: l.description,
      price: l.price,
      quantity: l.quantity,
      discount: 0,
    }));

    const payload = {
      customerNumber: String(ctx.customerInternalId),
      orderNumber: ctx.tranId,
      currency: ctx.currencyIso || "USD",
      billingAddress: ctx.billingAddress,
      shippingAddress: ctx.shippingAddress,
      lines: vpLines,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    console.error("versapay-order-payload error", err?.response?.data || err);
    return NextResponse.json(
      {
        error: "Failed to build Versapay payload",
        details: err?.message || err,
      },
      { status: 500 }
    );
  }
}
