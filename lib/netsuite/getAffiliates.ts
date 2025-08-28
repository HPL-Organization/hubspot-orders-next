import axios from "axios";
import { getValidToken } from "./token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export type Affiliate = {
  id: number;
  label: string;
  entityId: string | null;
  companyName: string | null;
  altName: string | null;
  inactive: boolean;
};

type FetchOpts = {
  includeInactive?: boolean;
  search?: string | null;
};

export async function fetchAffiliates(
  opts: FetchOpts = {}
): Promise<Affiliate[]> {
  const { includeInactive = false, search = null } = opts;

  const token = await getValidToken();

  const where: string[] = [];
  const params: string[] = [];

  if (!includeInactive) where.push(`isinactive = 'F'`);

  if (search) {
    where.push(
      `(LOWER(altname) LIKE :1 OR LOWER(companyname) LIKE :1 OR LOWER(entityid) LIKE :1)`
    );
    params.push(`%${search.toLowerCase()}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const sql = `
    SELECT
      id,
      entityid,
      altname,
      companyname,
      isinactive
    FROM partner
    ${whereSql}
    ORDER BY NVL(altname, NVL(companyname, entityid)) ASC
  `;

  const resp = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    params.length ? { q: sql, params } : { q: sql },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
    }
  );

  const rows: any[] = resp.data?.items ?? [];
  return rows.map((r) => {
    const entityId = r.entityid ?? null;
    const companyName = r.companyname ?? null;
    const altName = r.altname ?? null;
    const label = altName || companyName || entityId || `Partner #${r.id}`;
    return {
      id: Number(r.id),
      label,
      entityId,
      companyName,
      altName,
      inactive: String(r.isinactive).toUpperCase() === "T",
    } as Affiliate;
  });
}
