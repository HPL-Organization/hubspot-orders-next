import { getValidToken } from "./token";
import axios from "axios";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

async function runSuiteQL(query: string, accessToken: string): Promise<any[]> {
  let allItems: any[] = [];
  let url = `${BASE_URL}/query/v1/suiteql`;
  let payload = { q: query };

  while (url) {
    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
      timeout: 60000,
    });

    const items = resp.data.items ?? [];
    allItems.push(...items);

    const nextLink = resp.data.links?.find((l: any) => l.rel === "next");
    url = nextLink?.href || "";
  }

  return allItems;
}

export async function netsuiteGetSalesRepsQL(): Promise<
  { id: string; name: string }[]
> {
  const accessToken = await getValidToken();

  const suiteQL = `
SELECT
    id,
    entityid,
    firstname,
    lastname,
    email
  FROM employee
  WHERE isinactive = 'F'
     AND issalesrep = 'T'
  `;

  console.log(" Running SuiteQL to fetch sales reps...");
  const rows = await runSuiteQL(suiteQL, accessToken);

  return rows.map((emp) => ({
    id: emp.id,
    name: `${emp.firstname || ""} ${emp.lastname || ""}`.trim(),
    email: emp.email || null,
    entityId: emp.entityid || null,
  }));
}
