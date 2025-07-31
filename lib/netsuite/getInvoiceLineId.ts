import axios from "axios";
import { getValidToken } from "./token";

const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export async function getInvoiceLineId({
  invoiceId,
  salesOrderId,
  previousLineId,
}: {
  invoiceId: number;
  salesOrderId: number;
  previousLineId: number;
}) {
  const accessToken = await getValidToken();

  const query = `
    SELECT 
      T.id AS invoiceId, 
      TL.id AS invoiceLineId, 
      I.id AS itemId, 
      TL.quantity, 
      TL.rate, 
      TL.amount 
    FROM transaction T 
    INNER JOIN transactionline TL ON TL.transaction = T.id 
    INNER JOIN item I ON TL.item = I.id 
    INNER JOIN previoustransactionlinelink PTLL ON PTLL.nextline = TL.id 
    WHERE T.type = 'CustInvc' 
      AND T.id = ${invoiceId} 
      AND PTLL.previousdoc = ${salesOrderId} 
      AND PTLL.previousline = ${previousLineId}
  `;

  const resp = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    { q: query },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
    }
  );

  return resp.data.items?.[0] || null;
}
