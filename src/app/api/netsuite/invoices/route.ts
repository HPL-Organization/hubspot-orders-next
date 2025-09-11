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

const NETSUITE_UI_HOST = (
  process.env.NETSUITE_UI_HOST || `${NETSUITE_ACCOUNT_ID}.app.netsuite.com`
)
  .replace(/^https?:\/\//, "")
  .trim();

const NS_UI_BASE = `https://${NETSUITE_UI_HOST}`;

const invoiceUrl = (id: number | string) =>
  `${NS_UI_BASE}/app/accounting/transactions/custinvc.nl?whence=&id=${id}`;
const depositUrl = (id: number | string) =>
  `${NS_UI_BASE}/app/accounting/transactions/custdep.nl?whence=&id=${id}`;
const salesOrderUrl = (id: number | string) =>
  `${NS_UI_BASE}/app/accounting/transactions/salesord.nl?whence=&id=${id}`;

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

    // if (!invoiceIds.length) {
    //   return new Response(
    //     JSON.stringify({ invoices: [], customerId: soCustomerId }),
    //     { status: 200 }
    //   );
    // }
    const customerId = soCustomerId;
    let deposits: any[] = [];
    if (customerId) {
      // 1) Get deposits for this customer
      const depositsQ = `
    SELECT
      T.id AS depositId,
      T.tranid AS tranId,
      T.trandate AS trandate,
      BUILTIN.DF(T.status) AS status,
      T.total AS total
    FROM transaction T
    WHERE T.type = 'CustDep'
      AND T.entity = ${Number(customerId)}
    ORDER BY T.trandate DESC
  `;
      const depResp = await axios.post(
        `${BASE_URL}/query/v1/suiteql`,
        { q: depositsQ },
        { headers }
      );
      const depItems = depResp?.data?.items || [];

      if (depItems.length) {
        // 2) Map deposits -> Sales Order via PreviousTransactionLink
        const depositIds = depItems
          .map((d: any) => Number(d.depositid))
          .filter((n: any) => Number.isFinite(n));
        let linkMap = new Map<
          number,
          { soId: number; soTranId: string | null }
        >();

        if (depositIds.length) {
          const linkQ = `
        SELECT
          PTL.NextDoc AS depositId,
          PTL.PreviousDoc AS soId,
          BUILTIN.DF(PTL.PreviousDoc) AS soTranId
        FROM PreviousTransactionLink PTL
        WHERE PTL.NextDoc IN (${depositIds.join(",")})
      `;
          const linkResp = await axios.post(
            `${BASE_URL}/query/v1/suiteql`,
            { q: linkQ },
            { headers }
          );
          const linkItems = linkResp?.data?.items || [];
          for (const r of linkItems) {
            const did = Number(r.depositid);
            const soId = Number(r.soid);
            const soTranId = r.sotranid || null;
            if (Number.isFinite(did) && Number.isFinite(soId)) {
              linkMap.set(did, { soId, soTranId });
            }
          }
        }

        // 3) Classify status and build output
        deposits = depItems.map((d: any) => {
          const depositId = Number(d.depositid);
          const statusStr = String(d.status || "");
          const isFullyApplied =
            /applied/i.test(statusStr) && /fully/i.test(statusStr);
          const isPartiallyApplied = /partially\s*applied/i.test(statusStr);
          // "Unapplied" in the sense of still having remaining value: anything not Fully Applied
          const isUnapplied = !isFullyApplied;

          const link = linkMap.get(depositId) || null;
          const isAppliedToSO = !!link;
          const isUnappliedToSO = !isAppliedToSO;

          return {
            depositId,
            tranId: d.tranid,
            trandate: d.trandate,
            status: statusStr,
            total: Number(d.total ?? 0),
            appliedTo: link
              ? {
                  soId: link.soId,
                  soTranId: link.soTranId,
                  netsuiteUrl: salesOrderUrl(link.soId),
                }
              : null,
            isFullyApplied,
            isPartiallyApplied,
            isAppliedToSO,
            isUnapplied,
            isUnappliedToSO,
            netsuiteUrl: depositUrl(depositId),
          };
        });
      }
    }

    const unappliedDeposits = deposits.filter((d) => d.isUnappliedToSO);
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
          T.total AS amount,
          BUILTIN.DF(T.paymentoption) AS paymentOption
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
          paymentOption: p.paymentoption,
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
        netsuiteUrl: invoiceUrl(data.id),
      });
    }

    return new Response(
      JSON.stringify({
        invoices,
        deposits,
        unappliedDeposits,
        customerId: soCustomerId,
      }),
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
