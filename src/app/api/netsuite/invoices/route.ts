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
    //console.log(token);

    // Step 1: Get invoice internal IDs linked to the Sales Order
    const suiteQL = `
      SELECT T.id AS invoiceId, T.tranid
      FROM transaction T
      INNER JOIN PreviousTransactionLink PTL ON PTL.NextDoc = T.id
      WHERE T.type = 'CustInvc' AND PTL.PreviousDoc = ${soId}
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

    const invoiceIds = resp.data.items?.map((i: any) => i.invoiceid) || [];

    // Step 2: Fetch each invoice using REST Record API with expandSubResources=true
    const invoices = [];
    for (const id of invoiceIds) {
      const invoiceResp = await axios.get(
        `${BASE_URL}/record/v1/invoice/${id}?expandSubResources=true`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      const data = invoiceResp.data;

      // Step 2a: Get related customer payments using TransactionLine.CreatedFrom
      const paymentsSuiteQL = `
 SELECT
  T.id AS paymentId,
  T.tranid AS tranId,
  T.trandate AS paymentDate,
  BUILTIN.DF(T.status) AS status,
  T.total AS amount
FROM transaction T
INNER JOIN transactionline TL
  ON TL.transaction = T.id
  AND TL.createdfrom = ${data.id}
WHERE T.type = 'CustPymt'
`;

      const paymentsResp = await axios.post(
        `${BASE_URL}/query/v1/suiteql`,
        { q: paymentsSuiteQL },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            Prefer: "transient",
          },
        }
      );

      const payments =
        paymentsResp.data.items?.map((p: any) => ({
          paymentId: p.paymentid,
          tranId: p.tranid,
          paymentDate: p.paymentdate,
          amount: p.amount,
          status: p.status,
        })) || [];
      console.log(" Raw SuiteQL payments:", paymentsResp.data.items);

      const lines =
        data.item?.items?.map((line: any) => ({
          itemId: line.item?.id,
          itemName: line.item?.refName,
          quantity: line.quantity,
          rate: line.rate,
          amount: line.amount,
          description: line.description,
        })) || [];

      invoices.push({
        invoiceId: data.id,
        tranId: data.tranId,
        total: data.total,
        amountPaid: data.amountPaid,
        amountRemaining: data.amountRemaining,
        lines,
        payments,
      });
    }

    return new Response(JSON.stringify({ invoices }), { status: 200 });
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
