import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "../../../../../lib/netsuite/token";

const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
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

    const suiteQL = `
      SELECT 
        T.id,
        T.tranid,
        T.total,
        T.status
      FROM 
        transaction T
        INNER JOIN PreviousTransactionLink PTL ON PTL.NextDoc = T.id
      WHERE 
        T.type = 'CustInvc'
        AND PTL.PreviousDoc = ${soId}
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

    return new Response(JSON.stringify({ invoices: resp.data.items || [] }), {
      status: 200,
    });
  } catch (err: any) {
    console.error(
      " Failed to fetch invoices:",
      err.response?.data || err.message
    );
    return new Response(JSON.stringify({ error: "Could not load invoices" }), {
      status: 500,
    });
  }
}
