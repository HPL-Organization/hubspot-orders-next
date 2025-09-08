// app/api/netsuite/get-customer/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import axios from "axios";
import { getValidToken } from "../../../../../lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  "Content-Type": "application/json",
  Prefer: "transient",
});

// Build the UI-style <br>-separated address safely
function htmlAddr(fields: any) {
  if (!fields) return null;
  const s = (x: any) => (x == null ? null : String(x).trim());

  const addressee = s(
    fields.addressee ?? fields.addresseeName ?? fields.attention
  );
  const addr1 = s(fields.addr1 ?? fields.address1);
  const addr2 = s(fields.addr2 ?? fields.address2);
  const addr3 = s(fields.addr3 ?? fields.address3);
  const city = s(fields.city);
  const state = s(fields.state ?? fields.stateOrProvince);
  const zip = s(fields.zip ?? fields.postalCode);

  let countryRaw = fields.country;
  const country = s(
    typeof countryRaw === "object"
      ? countryRaw?.name ||
          countryRaw?.refName ||
          countryRaw?.text ||
          countryRaw?.code ||
          ""
      : countryRaw
  );

  const cityState = [city, state].filter(Boolean).join(" ");
  const line4 = [cityState || null, zip || null].filter(Boolean).join(" ");

  const parts = [addressee, addr1, addr2, addr3, line4 || null, country].filter(
    Boolean
  );
  return parts.length ? parts.join("<br>") : null;
}

// Returns true if addr mentions Massachusetts (full name) or standalone MA token
function isMassachusetts(addrHtml: string | null): boolean {
  if (!addrHtml) return false;
  const plain = addrHtml.replace(/<br\s*\/?>/gi, " ").toLowerCase();

  // Full name match
  if (plain.includes("massachusetts")) return true;

  // Standalone "MA" token (avoid matching 'main', etc.)
  const tokens = plain
    .replace(/[^a-z]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  return tokens.some((t) => t === "ma");
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const contactId = url.searchParams.get("contactId");
  if (!contactId) {
    return NextResponse.json(
      {
        internalId: null,
        name: null,
        bodyFields: { taxable: null, defaultaddress: null },
        error: "Missing contactId",
      },
      { status: 400 }
    );
  }

  try {
    const token = await getValidToken();
    const cid = contactId.replace(/'/g, "''");

    // 1) Find customer quickly
    const q = `
      SELECT id, entityid, isperson, companyname, firstname, lastname
      FROM customer
      WHERE custentityhs_id = '${cid}'
      FETCH FIRST 1 ROWS ONLY
    `;
    const { data: qData } = await axios.post(
      `${BASE_URL}/query/v1/suiteql`,
      { q },
      { headers: headers(token) }
    );

    const row = qData?.items?.[0];
    if (!row) {
      return NextResponse.json({
        internalId: null,
        name: null,
        bodyFields: { taxable: null, defaultaddress: null },
      });
    }

    const isPerson =
      row.isperson === true || row.isperson === "T" || row.isperson === 1;
    const name = isPerson
      ? [row.firstname, row.lastname].filter(Boolean).join(" ").trim() ||
        row.entityid
      : row.companyname || row.entityid;

    let defaultaddress: string | null = null;
    try {
      const list = await axios.get(
        `${BASE_URL}/record/v1/customer/${row.id}/addressBook`,
        { headers: headers(token) }
      );
      const items: any[] = list.data?.items || [];
      if (items.length) {
        items.sort((a, b) => {
          const sA =
            a?.defaultShipping === true ||
            a?.defaultShipping === "T" ||
            a?.defaultshipping === "T";
          const sB =
            b?.defaultShipping === true ||
            b?.defaultShipping === "T" ||
            b?.defaultshipping === "T";
          if (sA !== sB) return sA ? -1 : 1;
          const bA =
            a?.defaultBilling === true ||
            a?.defaultBilling === "T" ||
            a?.defaultbilling === "T";
          const bB =
            b?.defaultBilling === true ||
            b?.defaultBilling === "T" ||
            b?.defaultbilling === "T";
          if (bA !== bB) return bA ? -1 : 1;
          return 0;
        });

        const chosen = items[0];
        // Prefer explicit addressbookaddress link; else self + suffix; else inline
        const selfHref =
          chosen?.links?.find((l: any) => l?.rel === "self")?.href || null;
        const addrHref =
          chosen?.links?.find((l: any) =>
            String(l?.href || "").includes("/addressbookaddress")
          )?.href || (selfHref ? `${selfHref}/addressbookaddress` : null);

        let addrFields: any = null;
        if (addrHref) {
          try {
            const sub = await axios.get(addrHref, { headers: headers(token) });
            addrFields = sub.data?.fields ?? sub.data ?? null;
          } catch {
            // inline fallback
            addrFields =
              chosen?.addressbookaddress?.fields ??
              chosen?.addressbookaddress ??
              chosen?.address ??
              null;
          }
        } else {
          addrFields =
            chosen?.addressbookaddress?.fields ??
            chosen?.addressbookaddress ??
            chosen?.address ??
            null;
        }

        defaultaddress = htmlAddr(addrFields);
      }
    } catch {
      defaultaddress = null;
    }

    const taxable = isMassachusetts(defaultaddress) ? "T" : "F";

    return NextResponse.json({
      internalId: String(row.id ?? ""),
      name: name || null,
      bodyFields: { taxable, defaultaddress },
    });
  } catch {
    return NextResponse.json(
      {
        internalId: null,
        name: null,
        bodyFields: { taxable: null, defaultaddress: null },
        error: "Bad Request",
      },
      { status: 400 }
    );
  }
}
