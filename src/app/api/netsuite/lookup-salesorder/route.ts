// src/app/api/netsuite/lookup-salesorder/route.ts
import axios from "axios";
import { NextRequest, NextResponse } from "next/server";
import { getValidToken } from "../../../../../lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const escapeSql = (s: string) => String(s).replace(/'/g, "''");

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get("dealId");
  if (!dealId) {
    return NextResponse.json({ error: "Missing dealId" }, { status: 400 });
  }

  try {
    const accessToken = await getValidToken();

    const valueLit = `'${escapeSql(dealId)}'`;

    const q = `
      SELECT * FROM (
        SELECT
          t.id,
          t.tranid
        FROM transaction t
        WHERE t.type = 'SalesOrd'
          AND t.custbody_hpl_hs_so_id = ${valueLit}
        ORDER BY t.id DESC
      )
      WHERE ROWNUM = 1
    `;

    const resp = await axios.post(
      `${BASE_URL}/query/v1/suiteql`,
      { q },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          Prefer: "transient",
        },
      }
    );

    const row = resp.data?.items?.[0];
    if (!row) {
      return NextResponse.json({ found: false }, { status: 200 });
    }
    return NextResponse.json(
      { found: true, id: row.id, tranid: row.tranid },
      { status: 200 }
    );
  } catch (err: any) {
    const details =
      err?.response?.data || err?.message || "Unknown SuiteQL error";
    console.error("lookup-salesorder failed:", details);
    return NextResponse.json(
      { error: "Lookup failed", details },
      { status: 500 }
    );
  }
}
