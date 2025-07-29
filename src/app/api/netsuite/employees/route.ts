import { NextResponse } from "next/server";
import { netsuiteGetSalesRepsQL } from "../../../../../lib/netsuite/netsuiteGetSalesRepsQL";

export async function GET() {
  try {
    const reps = await netsuiteGetSalesRepsQL();
    return NextResponse.json(reps);
  } catch (error: any) {
    console.error("Failed to fetch sales reps:", error.message);
    return new NextResponse("Failed to fetch sales reps", { status: 500 });
  }
}
