// src/app/api/netsuite/record-deposit/route.ts
import { NextResponse } from "next/server";
import { recordDepositForSalesOrder } from "../../../../../lib/netsuite/recordDeposit";

export async function POST(req: Request) {
  try {
    const {
      salesOrderInternalId,
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

    if (!salesOrderInternalId || typeof amount !== "number") {
      return NextResponse.json(
        { error: "Missing salesOrderInternalId or amount" },
        { status: 400 }
      );
    }

    const result = await recordDepositForSalesOrder(salesOrderInternalId, {
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
        depositInternalId: result.id,
        deposit: result.raw,
      },
      { status: 200 }
    );
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500;
    return NextResponse.json(
      {
        error: "Failed to record deposit",
        details: String(e?.message || e),
        payload: e?.payload,
      },
      { status }
    );
  }
}
