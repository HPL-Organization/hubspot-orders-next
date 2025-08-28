import axios from "axios";
import { getValidToken } from "./token";

// lib/netsuite/getInvoicesForSalesOrder.ts

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;
export async function getInvoicesForSalesOrder(soId: string) {
  const token = await getValidToken();
  const suiteQL = `
    SELECT T.id, T.tranid, T.total, T.status
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

  const invoices = resp.data.items || ([] as any[]);

  // Filter out duplicates based on the invoice ID
  const uniqueInvoices = Array.from(
    new Map(invoices.map((inv) => [inv.id, inv])).values()
  );

  return invoices as any[];
}
