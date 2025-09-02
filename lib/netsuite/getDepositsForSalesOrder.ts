// lib/netsuite/getDepositsForSalesOrder.ts
import axios from "axios";
import { getValidToken } from "./token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export type DepositRow = {
  id: number;
  tranid: string;
  total: number;
  trandate: string;
};

export async function getDepositsForSalesOrder(
  soId: string | number
): Promise<DepositRow[]> {
  const token = await getValidToken();
  const so = Number(soId);
  if (!Number.isFinite(so)) throw new Error("Invalid Sales Order internalId");

  const suiteQL = `
    SELECT
      T.id,
      T.tranid,
      T.total,
      T.trandate
    FROM
      Transaction T
      INNER JOIN TransactionLine TL
        ON TL.Transaction = T.id
       AND TL.MainLine = 'T'
    WHERE
      T.type = 'CustDep'       -- customer deposit :contentReference[oaicite:1]{index=1}
      AND TL.CreatedFrom = ${so}
      AND T.voided = 'F'
    ORDER BY
      T.trandate DESC, T.id DESC
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

  const rows = (resp.data?.items ?? []) as DepositRow[];
  return Array.from(new Map(rows.map((r) => [r.id, r])).values());
}
