import { NextRequest } from "next/server";
import { getSalesOrderInternalIdFromDeal } from "../../../../lib/HubSpot";

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get("dealId");

  if (!dealId) {
    return new Response(JSON.stringify({ error: "Missing dealId" }), {
      status: 400,
    });
  }

  try {
    const internalId = await getSalesOrderInternalIdFromDeal(dealId);
    return new Response(JSON.stringify({ internalId }), { status: 200 });
  } catch (err) {
    console.error(" Error in /api/intid:", err);
    return new Response(
      JSON.stringify({ error: "Failed to fetch internalId" }),
      {
        status: 500,
      }
    );
  }
}
