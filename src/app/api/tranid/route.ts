import { NextRequest } from "next/server";
import { getSalesOrderNumberFromDeal } from "../../../../lib/HubSpot";

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get("dealId");

  if (!dealId) {
    return new Response(JSON.stringify({ error: "Missing dealId" }), {
      status: 400,
    });
  }

  try {
    const tranid = await getSalesOrderNumberFromDeal(dealId);
    return new Response(JSON.stringify({ tranid }), { status: 200 });
  } catch (err) {
    console.error(" Error in /api/tranid:", err);
    return new Response(JSON.stringify({ error: "Failed to fetch tranId" }), {
      status: 500,
    });
  }
}
