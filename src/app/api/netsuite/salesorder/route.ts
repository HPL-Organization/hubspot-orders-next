import { createNetsuiteSalesOrder } from "../../../../../lib/netsuite/createNetsuiteSalesOrder";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log(" Incoming body:", body);

    const {
      hubspotSoId,
      hubspotContactId,
      lineItems,
      shipComplete,
      salesTeam,
      salesChannel,
      affiliateId,
      salesOrderDate,
      dealName,
      orderNotes,
      billingTermsId,
    } = body;

    if (!hubspotSoId || !hubspotContactId || !Array.isArray(lineItems)) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 }
      );
    }

    const result = await createNetsuiteSalesOrder(
      hubspotSoId,
      hubspotContactId,
      lineItems,
      shipComplete,
      salesTeam,
      salesChannel,
      affiliateId,
      salesOrderDate ?? null,
      dealName,
      orderNotes,
      billingTermsId
    );
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err: any) {
    console.error(" Route error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
}
