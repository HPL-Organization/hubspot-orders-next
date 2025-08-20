// src/app/api/netsuite/get-affiliates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchAffiliates } from "../../../../../lib/netsuite/getAffiliates";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const includeInactive =
      (sp.get("includeInactive") ?? "false").toLowerCase() === "true";
    const search = sp.get("search")?.trim() || null;

    const affiliates = await fetchAffiliates({ includeInactive, search });
    return NextResponse.json({ affiliates });
  } catch (err: any) {
    const details = err?.response?.data ?? err?.message ?? "Unknown error";
    console.error("get-affiliates error:", details);
    return NextResponse.json(
      { error: "Failed to fetch affiliates", details },
      { status: 500 }
    );
  }
}
