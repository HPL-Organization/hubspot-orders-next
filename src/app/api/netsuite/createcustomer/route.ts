import { NextRequest } from "next/server";
import { createNetsuiteCustomer } from "../../../../../lib/netsuite/createNetsuiteCustomer";

export async function POST(req: NextRequest) {
  try {
    const customer = await req.json();

    const result = await createNetsuiteCustomer(customer);
    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
    });
  } catch (err: any) {
    console.error(
      "Error creating customer in NetSuite:",
      err?.response?.data || err.message
    );
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        status: 500,
      }
    );
  }
}
