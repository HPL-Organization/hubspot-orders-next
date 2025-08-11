import { NextResponse } from "next/server";
import { savePaymentMethod } from "../../../../../lib/netsuite/savePaymentMethod";

export async function POST(req: Request) {
  try {
    const { customerInternalId, token } = await req.json();

    const data = await savePaymentMethod(customerInternalId, token);

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error saving payment method:", error);
    return NextResponse.json(
      { error: "Failed to save payment method" },
      { status: 500 }
    );
  }
}
