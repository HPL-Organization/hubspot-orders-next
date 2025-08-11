import axios from "axios";
import { getValidToken } from "../../../../../lib/netsuite/token";

const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export async function PATCH(req) {
  const { netsuiteInternalId, shippingMethod } = await req.json();

  if (!netsuiteInternalId || !shippingMethod) {
    return new Response(
      JSON.stringify({ error: "Missing netsuiteInternalId or shippingMethod" }),
      { status: 400 }
    );
  }

  const accessToken = await getValidToken();

  try {
    const suiteQLQuery = `
      SELECT id, shipcarrier
      FROM transaction
      WHERE id = ${netsuiteInternalId}
        AND type = 'SalesOrd'
    `;

    const queryRes = await axios.post(
      `${BASE_URL}/query/v1/suiteql`,
      { q: suiteQLQuery },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          Prefer: "transient",
        },
      }
    );

    // Check if the record exists
    if (!queryRes.data || queryRes.data.items.length === 0) {
      throw new Error("Sales Order not found.");
    }

    // Log the existing shipcarrier field for debugging
    const existingShipCarrier = queryRes.data.items[0].shipcarrier;
    console.log("Existing Ship Carrier:", existingShipCarrier);

    // Prepare the update payload for the Sales Order
    const payload = {
      shipcarrier: {
        id: shippingMethod.toLowerCase(),
        refName: shippingMethod.toUpperCase(),
      },
    };

    const updateRes = await axios.patch(
      `${BASE_URL}/record/v1/salesOrder/${netsuiteInternalId}`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          Prefer: "transient",
        },
      }
    );

    console.log("Updated Sales Order:", updateRes.data);

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error(
      "Failed to update sales order:",
      error.response?.data || error.message
    );
    return new Response(
      JSON.stringify({
        error: error.response?.data || "Failed to update sales order",
      }),
      { status: 500 }
    );
  }
}
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const netsuiteInternalId = searchParams.get("netsuiteInternalId");

  if (!netsuiteInternalId) {
    return new Response(
      JSON.stringify({ error: "Missing netsuiteInternalId" }),
      { status: 400 }
    );
  }

  const accessToken = await getValidToken();

  try {
    const res = await axios.get(
      `${BASE_URL}/record/v1/salesOrder/${netsuiteInternalId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    console.log("Sales Order Structure:", JSON.stringify(res.data, null, 2));

    if (!res.data) {
      throw new Error("Sales Order not found.");
    }

    // Return the sales order data for inspection
    return new Response(JSON.stringify(res.data), { status: 200 });
  } catch (error) {
    console.error("Failed to fetch sales order:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch sales order" }),
      { status: 500 }
    );
  }
}
