import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "../../../../../lib/netsuite/token";

const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export async function GET(req: NextRequest) {
  const internalId = req.nextUrl.searchParams.get("internalId");

  if (!internalId) {
    return new Response(JSON.stringify({ error: "Missing internalId" }), {
      status: 400,
    });
  }

  try {
    const token = await getValidToken();

    //  Fetch Sales Order using REST Record API to get item line IDs
    const soResp = await axios.get(
      `${BASE_URL}/record/v1/salesOrder/${internalId}?expandSubResources=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    const orderedLineIds =
      soResp.data?.item?.items?.map((line: any) => String(line.line)) || [];

    console.log("Ordered line items", orderedLineIds);

    //  Fetch fulfilled lines using SuiteQL
    const fulfilledQuery = `
      SELECT DISTINCT PTLL.previousline AS lineId
      FROM transaction T
      INNER JOIN previoustransactionlinelink PTLL ON PTLL.nextdoc = T.id
      WHERE T.type = 'ItemShip' AND PTLL.previousdoc = ${internalId}
    `;

    const fulfilledResp = await axios.post(
      `${BASE_URL}/query/v1/suiteql`,
      { q: fulfilledQuery },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          Prefer: "transient",
        },
      }
    );

    const fulfilledLineIds =
      fulfilledResp.data.items?.map((r: any) => r.lineid) || [];

    console.log("Fulfilled line items", fulfilledLineIds);

    return new Response(
      JSON.stringify({
        orderedLineIds,
        fulfilledLineIds,
      }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error(
      "Failed to compute fulfillment status:",
      err.response?.data || err.message
    );
    return new Response(
      JSON.stringify({ error: "Could not determine fulfillment status" }),
      { status: 500 }
    );
  }
}
