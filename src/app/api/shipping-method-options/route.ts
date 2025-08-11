// src/app/api/shipping-method-options.js
import { getShippingMethodOptions } from "../../../../lib/HubSpot";

export async function GET(req) {
  try {
    const options = await getShippingMethodOptions();
    return new Response(JSON.stringify({ options }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
}
