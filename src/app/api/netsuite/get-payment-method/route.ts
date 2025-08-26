import { NextResponse } from "next/server";
import { getPaymentMethod } from "../../../../../lib/netsuite/getPaymentMethod";

export async function POST(req: Request) {
  try {
    const { customerInternalId } = await req.json();

    if (!customerInternalId) {
      return NextResponse.json(
        { success: false, message: "customerInternalId is required" },
        { status: 400 }
      );
    }

    const data = await getPaymentMethod(Number(customerInternalId));
    console.log("get payment data shape check", data);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error fetching payment methods:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch payment methods" },
      { status: 500 }
    );
  }
}
