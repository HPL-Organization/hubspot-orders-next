// app/api/hubspot/get-contact/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const dealId = url.searchParams.get("dealId");
  const token = process.env.HUBSPOT_TOKEN;

  if (!dealId) {
    return NextResponse.json(
      { contactId: null, error: "Missing dealId" },
      { status: 400 }
    );
  }
  if (!token) {
    return NextResponse.json(
      { contactId: null, error: "Missing HUBSPOT_TOKEN" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(
        dealId
      )}/associations/contacts?limit=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      let msg = `HubSpot request failed: ${res.status}`;
      try {
        const body = await res.json();
        if (body?.message) msg = body.message;
      } catch {}
      return NextResponse.json(
        { contactId: null, error: msg },
        { status: res.status }
      );
    }

    const data: { results?: Array<{ id: string }> } = await res.json();
    const contactId = data?.results?.[0]?.id ?? null;
    return NextResponse.json({ contactId });
  } catch (err: any) {
    return NextResponse.json(
      { contactId: null, error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
