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
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "transient",
    } as const;

    // 1) SuiteQL for invoices linked to this Sales Order
    const invoiceQ = `
      SELECT T.id AS invoiceId, T.tranid
      FROM transaction T
      INNER JOIN PreviousTransactionLink PTL ON PTL.NextDoc = T.id
      WHERE T.type = 'CustInvc' AND PTL.PreviousDoc = ${soId}
    `;

    // 2) SuiteQL for Sales Order customer id (entity)
    const soCustomerQ = `
      SELECT T.entity AS customerId
      FROM transaction T
      WHERE T.id = ${soId}
    `;

    const [invResp, soResp] = await Promise.all([
      axios.post(`${BASE_URL}/query/v1/suiteql`, { q: invoiceQ }, { headers }),
      axios.post(
        `${BASE_URL}/query/v1/suiteql`,
        { q: soCustomerQ },
        { headers }
      ),
    ]);

    const soCustomerId =
      soResp?.data?.items?.[0]?.customerid != null
        ? Number(soResp.data.items[0].customerid)
        : null;

    const invoiceIds: number[] =
      invResp?.data?.items?.map((i: any) => Number(i.invoiceid)) || [];

    if (!invoiceIds.length) {
      return new Response(
        JSON.stringify({ invoices: [], customerId: soCustomerId }),
        { status: 200 }
      );
    }

    const invoices: any[] = [];
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
        { headers }
      );

      const payments =
        paymentsResp.data.items?.map((p: any) => ({
          paymentId: p.paymentid,
          tranId: p.tranid,
          paymentDate: p.paymentdate,
          amount: p.amount,
          status: p.status,
        })) || [];

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
        trandate: data.tranDate,
        total: data.total,
        amountPaid: data.amountPaid,
        amountRemaining: data.amountRemaining,
        customerId: data?.entity?.id ?? soCustomerId,
        lines,
        payments,
      });
    }

    return new Response(
      JSON.stringify({ invoices, customerId: soCustomerId }),
      {
        status: 200,
      }
    );
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

// patch for date update
export async function PATCH(req: NextRequest) {
  try {
    const { invoiceId, invoiceInternalId, trandate } = await req.json();
    const id = Number(invoiceId ?? invoiceInternalId);
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing invoiceId" }), {
        status: 400,
      });
    }
    if (!trandate || !/^\d{4}-\d{2}-\d{2}$/.test(String(trandate))) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing trandate (YYYY-MM-DD)" }),
        { status: 400 }
      );
    }

    const token = await getValidToken();
    await axios.patch(
      `${BASE_URL}/record/v1/invoice/${id}`,
      { trandate: String(trandate) },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    );

    return new Response(JSON.stringify({ ok: true, invoiceId: id, trandate }), {
      status: 200,
    });
  } catch (err: any) {
    console.error(
      " Failed to update invoice date:",
      err?.response?.data || err?.message
    );
    return new Response(
      JSON.stringify({ error: "Could not update invoice date" }),
      { status: 500 }
    );
  }
}
