// lib/hubspot/checkShippingAddress.ts
import axios from "axios";

const HS_BASE = "https://api.hubapi.com";
const HS_TOKEN = process.env.HUBSPOT_TOKEN;

export type HubSpotAddress = { country?: string };

export async function getContactShippingAddress(
  hubspotContactId: string
): Promise<HubSpotAddress | null> {
  const props = ["shipping_country_region", "country"];

  try {
    const res = await axios.get(
      `${HS_BASE}/crm/v3/objects/contacts/${hubspotContactId}`,
      {
        params: { properties: props.join(",") },
        headers: { Authorization: `Bearer ${HS_TOKEN}` },
      }
    );

    const p = res.data?.properties ?? {};
    const fromContact = (p.shipping_country_region ?? p.country)
      ?.toString()
      .trim();

    if (fromContact) return { country: fromContact };

    // fallback: company association
    const assoc = await axios.get(
      `${HS_BASE}/crm/v4/objects/contacts/${hubspotContactId}/associations/companies?limit=1`,
      { headers: { Authorization: `Bearer ${HS_TOKEN}` } }
    );

    const companyId =
      assoc.data?.results?.[0]?.toObjectId || assoc.data?.results?.[0]?.id; // handle either shape
    if (!companyId) return null;

    const cres = await axios.get(
      `${HS_BASE}/crm/v3/objects/companies/${companyId}`,
      {
        params: { properties: "shipping_country_region,country" },
        headers: { Authorization: `Bearer ${HS_TOKEN}` },
      }
    );
    const cp = cres.data?.properties ?? {};
    const fromCompany = (cp.shipping_country_region ?? cp.country)
      ?.toString()
      .trim();

    return fromCompany ? { country: fromCompany } : null;
  } catch (e: any) {
    console.error(
      "Failed to fetch HubSpot contact/company address",
      e.response?.data || e.message
    );
    return null;
  }
}

export function isInternational(country?: string): boolean {
  if (!country) return false;
  const c = country.toLowerCase().replace(/\./g, "").trim();
  const usAliases = new Set([
    "us",
    "usa",
    "united states",
    "united states of america",
    "u s",
    "u s a",
  ]);
  return !usAliases.has(c);
}
