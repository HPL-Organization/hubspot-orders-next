// app/api/hubspot/prepend-tranid/route.ts
import { NextResponse } from "next/server";

const HS_BASE = "https://api.hubapi.com";
const MAX_LEN = 255;

export async function POST(req: Request) {
  try {
    const { dealId, tranid, delimiter = " — " } = await req.json();

    if (!dealId || !tranid) {
      return NextResponse.json(
        { error: "dealId and tranid are required" },
        { status: 400 }
      );
    }

    const token = process.env.HUBSPOT_TOKEN;

    if (!token) {
      return NextResponse.json(
        { error: "HubSpot token not configured on server" },
        { status: 500 }
      );
    }

    const getRes = await fetch(
      `${HS_BASE}/crm/v3/objects/deals/${encodeURIComponent(
        dealId
      )}?properties=dealname`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const current = await getRes.json();
    if (!getRes.ok) {
      return NextResponse.json(
        { error: `HubSpot GET failed`, details: current },
        { status: getRes.status }
      );
    }

    const currentName = (current?.properties?.dealname ?? "").trim();

    const alreadyPrefixed =
      currentName === tranid ||
      currentName.startsWith(`${tranid} `) ||
      currentName.startsWith(`${tranid}-`) ||
      currentName.startsWith(`${tranid} — `) ||
      currentName.startsWith(`[${tranid}] `);

    if (alreadyPrefixed) {
      return NextResponse.json({
        ok: true,
        updated: false,
        dealname: currentName,
      });
    }

    let newName = `${tranid}${delimiter}${currentName}`.trim();
    if (newName.length > MAX_LEN) newName = newName.slice(0, MAX_LEN);

    const patchRes = await fetch(
      `${HS_BASE}/crm/v3/objects/deals/${encodeURIComponent(dealId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties: { dealname: newName } }),
      }
    );
    const patchJson = await patchRes.json();
    if (!patchRes.ok) {
      return NextResponse.json(
        { error: `HubSpot PATCH failed`, details: patchJson },
        { status: patchRes.status }
      );
    }

    return NextResponse.json({ ok: true, updated: true, dealname: newName });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
