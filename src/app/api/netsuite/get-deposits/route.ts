// src/app/api/netsuite/get-deposits/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDepositsForSalesOrder } from "../../../../../lib/netsuite/getDepositsForSalesOrder";

export async function GET(req: NextRequest) {
  const internalId =
    req.nextUrl.searchParams.get("internalId") ||
    req.nextUrl.searchParams.get("soId");
  if (!internalId) {
    return NextResponse.json({ error: "Missing internalId" }, { status: 400 });
  }

  try {
    const deposits = await getDepositsForSalesOrder(internalId);

    const items = deposits.map((d) => ({
      id: d.id,
      number: d.tranid,
      amount: d.total,
      date: d.trandate,
    }));

    return NextResponse.json({ items });
  } catch (error: any) {
    const status = error?.response?.status ?? 500;
    const details = error?.response?.data ?? error?.message ?? error;
    console.error("Failed to fetch customer deposits:", details);
    return NextResponse.json(
      { error: "Failed to fetch customer deposits", details },
      { status }
    );
  }
}
