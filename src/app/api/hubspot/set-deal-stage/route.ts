import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { dealId, stage } = await req.json().catch(() => ({}));

    if (!dealId || !stage) {
      return NextResponse.json(
        { error: "Missing dealId or stage" },
        { status: 400 }
      );
    }

    const token = process.env.HUBSPOT_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "Server misconfig: HUBSPOT_TOKEN not set" },
        { status: 500 }
      );
    }

    const hsRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ properties: { dealstage: String(stage) } }),
      }
    );

    const contentType = hsRes.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await hsRes.json()
      : await hsRes.text();

    if (!hsRes.ok) {
      return NextResponse.json(
        { ok: false, error: "HubSpot update failed", details: payload },
        { status: hsRes.status }
      );
    }

    return NextResponse.json({
      ok: true,
      id: (payload as any)?.id ?? null,
      stage: (payload as any)?.properties?.dealstage ?? String(stage),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Unexpected server error", details: err?.message },
      { status: 500 }
    );
  }
}
