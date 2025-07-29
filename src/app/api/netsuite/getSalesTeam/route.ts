// src/app/api/netsuite/getSalesTeam/route.ts
import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { getValidToken } from "../../../../../lib/netsuite/token";

const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const internalId = searchParams.get("internalId");
  if (!internalId) {
    return NextResponse.json({ error: "Missing internalId" }, { status: 400 });
  }

  try {
    const token = await getValidToken();

    const resp = await axios.get(
      `${BASE_URL}/record/v1/salesOrder/${internalId}?expandSubResources=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    const team = resp.data.salesTeam?.items || [];
    const mapped = team.map((m: any) => ({
      id: m.employee?.id,
      name: m.employee?.name,
      contribution: m.contribution,
      isPrimary: m.isPrimary,
    }));

    return NextResponse.json({ team: mapped });
  } catch (error: any) {
    console.error(" Error fetching sales team:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch sales team" },
      { status: 500 }
    );
  }
}
