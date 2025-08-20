import { NextResponse } from "next/server";
import { getSalesChannelOptions } from "../../../../../lib/netsuite/getSalesChannel";

export const dynamic = "force-dynamic";
const FIELD = "cseg_nsps_so_class"; //sales channel field name

export async function GET() {
  try {
    const options = await getSalesChannelOptions(FIELD);
    return NextResponse.json(options, { status: 200 });
  } catch (error: any) {
    console.error(
      "Error fetching sales channel options:",
      error?.message ?? error
    );
    return NextResponse.json(
      { error: "Failed to fetch sales channel options" },
      { status: 500 }
    );
  }
}
