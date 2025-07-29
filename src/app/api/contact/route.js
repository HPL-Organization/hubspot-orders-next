// src/app/api/contact/route.js
import { getContactByDealId, updateContactById } from "../../../../lib/HubSpot";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get("dealId");

  if (!dealId) {
    return new Response(JSON.stringify({ error: "Missing dealId" }), {
      status: 400,
    });
  }

  try {
    const contact = await getContactByDealId(dealId);
    return new Response(JSON.stringify(contact), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
}

export async function PATCH(req) {
  const body = await req.json();
  const { contactId, update } = body;

  if (!contactId || !update) {
    return new Response(
      JSON.stringify({ error: "Missing contactId or update data" }),
      {
        status: 400,
      }
    );
  }

  try {
    const result = await updateContactById(contactId, update);
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    console.error("HubSpot Update Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
}
