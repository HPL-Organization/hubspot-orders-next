import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN!;
const hubspot = axios.create({
  baseURL: "https://api.hubapi.com",
  headers: {
    Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    "Content-Type": "application/json",
  },
});

export async function POST(req: NextRequest) {
  const { email, dealId } = await req.json();

  if (!email || !dealId) {
    return NextResponse.json(
      { error: "Missing email or dealId" },
      { status: 400 }
    );
  }

  try {
    // Step 1: Get HubSpot user ID from email
    const userResp = await hubspot.get(`/crm/v3/owners`, {
      params: {
        email,
      },
    });

    const matchedOwner = userResp.data.results?.find(
      (user: any) => user.email === email
    );

    if (!matchedOwner) {
      return NextResponse.json(
        { error: "User not found in HubSpot" },
        { status: 404 }
      );
    }

    const ownerId = matchedOwner.id;

    // Step 2: Update the deal with new owner
    await hubspot.patch(`/crm/v3/objects/deals/${dealId}`, {
      properties: {
        hubspot_owner_id: ownerId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error(
      " Error updating deal owner:",
      err.response?.data || err.message
    );
    return NextResponse.json(
      { error: "Failed to update deal owner" },
      { status: 500 }
    );
  }
}

//GET: Deal owner

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get("dealId");

  if (!dealId) {
    return NextResponse.json({ error: "Missing dealId" }, { status: 400 });
  }

  try {
    // Step 1: Get hubspot_owner_id
    const dealRes = await hubspot.get(`/crm/v3/objects/deals/${dealId}`, {
      params: { properties: "hubspot_owner_id" },
    });

    const ownerId = dealRes.data.properties?.hubspot_owner_id;

    if (!ownerId) {
      return NextResponse.json({ ownerEmail: null });
    }

    // Step 2: Get owner details (email)
    const ownerRes = await hubspot.get(`/crm/v3/owners/${ownerId}`);
    const ownerEmail = ownerRes.data.email;

    return NextResponse.json({ ownerEmail });
  } catch (err: any) {
    console.error(
      " Error fetching deal owner:",
      err.response?.data || err.message
    );
    return NextResponse.json(
      { error: "Failed to fetch deal owner" },
      { status: 500 }
    );
  }
}
