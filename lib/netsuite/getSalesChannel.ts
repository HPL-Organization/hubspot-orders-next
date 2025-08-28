import axios from "axios";
import { getValidToken } from "./token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;

//const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

function toCustomRecordType(field: string): string {
  if (!field || !field.startsWith("cseg_")) {
    throw new Error(
      `Unsupported field "${field}". Expected a custom segment script id starting with "cseg_".`
    );
  }
  return `customrecord_${field}`;
}

function isInactiveFlag(v: unknown): boolean {
  if (v === true || v === "T") return true;
  return false;
}

function extractRows(data: any): Array<any> {
  if (!data) return [];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

export async function getSalesChannelOptions(
  field: string
): Promise<Array<{ id: string; value: string; label?: string }>> {
  const token = await getValidToken();
  const table = toCustomRecordType(field);

  const sql = `
    SELECT id, name, isinactive
    FROM ${table}
    ORDER BY name
  `;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",

    Prefer: "transient",
  };

  const resp = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    { q: sql },
    { headers }
  );

  const rows = extractRows(resp.data);

  const out = rows
    .filter((r: any) => !isInactiveFlag(r?.isinactive))
    .map((r: any) => {
      const id = String(r?.id ?? "");
      const name =
        typeof r?.name === "string"
          ? (r.name as string)
          : r?.name?.value ?? String(r?.name ?? "");
      return { id, value: name, label: name };
    })
    .filter((o: any) => o.id && o.value);

  out.sort((a, b) =>
    (a.label ?? a.value).localeCompare(b.label ?? b.value, undefined, {
      sensitivity: "base",
    })
  );

  return out;
}
