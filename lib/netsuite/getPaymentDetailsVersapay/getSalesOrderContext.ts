// lib/netsuite/getPaymentDetailsVersapay/getSalesOrderContext.ts
import { runSuiteQL } from "./suiteql";
import { getCustomerBasic } from "./getCustomer";

function symbolToISO(sym?: string) {
  const s = (sym || "").trim();
  if (s === "$") return "USD";
  if (s === "C$" || s === "CA$") return "CAD";
  if (s === "€") return "EUR";
  if (s === "£") return "GBP";
  return s.toUpperCase() || "USD";
}
function normalizeCountry(val?: string) {
  if (!val) return "US";
  const up = String(val).toUpperCase();
  if (/^[A-Z]{2}$/.test(up)) return up;
  if (up.includes("UNITED STATES")) return "US";
  if (up.includes("CANADA")) return "CA";
  return up.slice(0, 2);
}

export type VersapayAddress = {
  contactFirstName?: string;
  contactLastName?: string;
  companyName?: string;
  address1: string;
  address2?: string;
  city: string;
  stateOrProvince?: string;
  postCode?: string;
  country: string;
  email?: string;
  phone?: string;
};

export type SalesOrderContext = {
  netsuiteInternalId: number;
  tranId: string;
  customerInternalId: number;
  currencyIso: string;
  billingAddress: VersapayAddress;
  shippingAddress: VersapayAddress;
};

export async function getSalesOrderContextById(
  soId: number
): Promise<SalesOrderContext> {
  const id = Number(soId);

  // Pull addresses via addressbook/addressbookaddress; also join customer's default addr as fallback
  const rows = await runSuiteQL(`
  SELECT
    t.id,
    t.tranid,
    t.entity AS customerInternalId,
    COALESCE(cur.symbol, cur.name) AS currencyRaw,

    -- SO-level address text via pointers (display value)
    BUILTIN.DF(t.billaddresslist) AS so_bill_text,
    BUILTIN.DF(t.shipaddresslist) AS so_ship_text,

    -- Customer default address text as fallback (no join to addressbookaddress table!)
    BUILTIN.DF(db.addressbookaddress) AS def_bill_text,
    BUILTIN.DF(ds.addressbookaddress) AS def_ship_text

  FROM transaction t
  LEFT JOIN currency cur ON cur.id = t.currency

  -- Customer defaults (addressbook is exposed; we only DF() its addressbookaddress field)
  LEFT JOIN addressbook db ON db.entity = t.entity AND db.defaultbilling  = 'T'
  LEFT JOIN addressbook ds ON ds.entity = t.entity AND ds.defaultshipping = 'T'

  WHERE t.id = ${id} AND t.type = 'SalesOrd'
  FETCH FIRST 1 ROWS ONLY
`);

  if (!rows.length) throw new Error(`Sales Order ${id} not found`);
  const r = rows[0];
  const currencyIso = symbolToISO(r.currencyRaw);

  // Prefer SO-specific address; fall back to customer's default if null
  const bill = {
    address1: r.so_bill_addr1 ?? r.def_bill_addr1 ?? "",
    address2: r.so_bill_addr2 ?? r.def_bill_addr2 ?? "",
    city: r.so_bill_city ?? r.def_bill_city ?? "",
    stateOrProvince: r.so_bill_state ?? r.def_bill_state ?? "",
    postCode: r.so_bill_zip ?? r.def_bill_zip ?? "",
    country: normalizeCountry(r.so_bill_country ?? r.def_bill_country),
  };
  const ship = {
    address1: r.so_ship_addr1 ?? r.def_ship_addr1 ?? "",
    address2: r.so_ship_addr2 ?? r.def_ship_addr2 ?? "",
    city: r.so_ship_city ?? r.def_ship_city ?? "",
    stateOrProvince: r.so_ship_state ?? r.def_ship_state ?? "",
    postCode: r.so_ship_zip ?? r.def_ship_zip ?? "",
    country: normalizeCountry(r.so_ship_country ?? r.def_ship_country),
  };

  // Enrich with customer names/email/phone
  const customer = await getCustomerBasic(Number(r.customerInternalId));
  const companyName =
    customer.companyName ||
    [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
    "Customer";

  const billingAddress: VersapayAddress = {
    ...bill,
    contactFirstName: customer.firstName || "Billing",
    contactLastName: customer.lastName || "Contact",
    companyName,
    email: customer.email,
    phone: customer.phone,
  };

  const shippingAddress: VersapayAddress = {
    ...ship,
    contactFirstName: customer.firstName || "Shipping",
    contactLastName: customer.lastName || "Contact",
    companyName,
    email: customer.email,
    phone: customer.phone,
  };

  return {
    netsuiteInternalId: id,
    tranId: r.tranid,
    customerInternalId: Number(r.customerInternalId),
    currencyIso,
    billingAddress,
    shippingAddress,
  };
}
