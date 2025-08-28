import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "../../../../../lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export async function GET(req: NextRequest) {
  const soId = req.nextUrl.searchParams.get("internalId");

  if (!soId) {
    return new Response(JSON.stringify({ error: "Missing internalId" }), {
      status: 400,
    });
  }

  try {
    const token = await getValidToken();

    //  Query fulfilled line items (linked via PreviousTransactionLineLink)
    const suiteQL = `
      SELECT DISTINCT
        TL2.item AS itemId
      FROM
        Transaction T
        INNER JOIN PreviousTransactionLineLink PTLL ON PTLL.NextDoc = T.ID
        INNER JOIN TransactionLine TL2 ON TL2.Transaction = T.ID
      WHERE
        T.Type = 'ItemShip'
        AND PTLL.PreviousDoc = ${soId}
    `;

    const resp = await axios.post(
      `${BASE_URL}/query/v1/suiteql`,
      { q: suiteQL },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          Prefer: "transient",
        },
      }
    );
    console.log("Resposnse from fulfilled line items", resp.data);

    const fulfilledItemIds = resp.data.items.map(
      (line: any) => line.itemid || line.itemId || line.item
    );

    return new Response(JSON.stringify({ fulfilledItemIds }), {
      status: 200,
    });
  } catch (err: any) {
    console.error(
      "Failed to fetch fulfilled line items:",
      err.response?.data || err.message
    );
    return new Response(
      JSON.stringify({ error: "Could not load fulfilled items" }),
      { status: 500 }
    );
  }
}
