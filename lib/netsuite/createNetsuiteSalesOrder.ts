import axios from "axios";
import { getValidToken } from "./token";
import {
  updateDealWithSalesOrder,
  updateDealWithSalesOrderInternalId,
} from "../HubSpot";
import { getInvoiceLineId } from "./getInvoiceLineId";
import { getInvoicesForSalesOrder } from "./getInvoicesForSalesOrder";
import {
  getContactShippingAddress,
  isInternational,
} from "../hubspot/checkShippingAddress";
import https from "https";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;
function normalizeBillingTermsId(v?: string | null): string | null {
  const s = String(v ?? "").trim();
  return s === "2" || s === "7" ? s : null;
}

// Main export
export async function createNetsuiteSalesOrder(
  hubspotSoId: string,
  hubspotContactId: string,
  lineItems: {
    itemId: string;
    quantity: number;
    unitPrice: number;
    unitDiscount: number;
    isClosed: boolean;
  }[],
  shipComplete: boolean,
  salesTeam: {
    replaceAll: boolean;
    items: {
      employee: { id: string };
      isPrimary: boolean;
      contribution: number;
    }[];
  },
  salesChannelId?: string | null,
  affiliateId?: string | null,
  salesOrderDate?: string | null,
  dealName?: string | null,
  orderNotes?: string | null,
  billingTermsId?: string | null,
  soReference?: string | ""
) {
  const accessToken = await getValidToken();
  const resolvedSalesChannelId =
    (salesChannelId && String(salesChannelId)) || "13";
  const resolvedAffiliateId =
    affiliateId != null && String(affiliateId).trim() !== ""
      ? String(affiliateId)
      : null;
  const resolvedBillingTermsId = normalizeBillingTermsId(billingTermsId);

  // Resolve dates
  console.log("checking tran date", salesOrderDate);
  const createTrandate =
    normalizeDateInput(salesOrderDate) || todayInEasternYYYYMMDD();
  const patchTrandate = normalizeDateInput(salesOrderDate) || undefined;
  const addr = await getContactShippingAddress(hubspotContactId);
  const effectiveShipComplete = isInternational(addr?.country)
    ? true
    : shipComplete;
  const customerId = await findCustomerByHubspotId(
    hubspotContactId,
    accessToken
  );
  if (!customerId) throw new Error("Customer not found in NetSuite");

  const existingSOId = await findSalesOrderByHubspotSoId(
    hubspotSoId,
    accessToken
  );

  const payload = buildBasePayload(
    customerId,
    hubspotSoId,
    effectiveShipComplete,
    salesTeam,
    lineItems,
    resolvedSalesChannelId,
    resolvedAffiliateId,
    createTrandate,
    dealName,
    orderNotes,
    resolvedBillingTermsId,
    soReference
  );

  try {
    if (existingSOId) {
      //console.log("Existing", existingSOId);
      const { existingLineMap, fulfilledLines, existingSalesTeam } =
        await getExistingOrderState(existingSOId, accessToken);

      const { filteredLines, patchedLineIdMap } = buildPatchLines(
        lineItems,
        existingLineMap,
        fulfilledLines
      );

      await syncInvoicesWithSalesOrder(
        existingSOId,
        patchedLineIdMap,
        lineItems,
        accessToken
      );

      const cleanedSalesTeam = cleanSalesTeam(
        existingSalesTeam,
        salesTeam.items
      );

      await clearSalesTeam(existingSOId, accessToken);
      await clearPartners(existingSOId, accessToken);
      await applySalesOrderPatch(
        existingSOId,
        filteredLines,
        cleanedSalesTeam,
        effectiveShipComplete,
        accessToken,
        resolvedSalesChannelId,
        resolvedAffiliateId,
        patchTrandate,
        dealName,
        orderNotes,
        resolvedBillingTermsId,
        soReference
      );
    } else {
      //console.log("not Existing", existingSOId);
      await createNewSalesOrder(payload, accessToken);
      const createdId = await findSalesOrderByHubspotSoId(
        hubspotSoId,
        accessToken
      );
      console.log("created id", createdId);
      if (!createdId)
        throw new Error("Sales Order was created but ID could not be fetched");

      const tranid = await fetchTranIdFromSO(createdId, accessToken);
      await updateDealWithSalesOrder(hubspotSoId, tranid);
      await updateDealWithSalesOrderInternalId(hubspotSoId, createdId);

      return { id: createdId, created: true, netsuiteTranId: tranid };
    }
  } catch (error: any) {
    handleNetsuiteError(error);
  }
}

function buildBasePayload(
  customerId: string,
  hubspotSoId: string,
  shipComplete: boolean,
  salesTeam: any,
  lineItems: any[],
  salesChannelId: string,
  affiliateId: string | null,
  trandate: string,
  dealName: string | null,
  orderNotes?: string,
  billingTermsId?: string | null,
  soReference?: string | ""
) {
  return {
    entity: { id: customerId },
    custbodyhs_so_id: hubspotSoId,
    subsidiary: { id: "2" },
    currency: { id: "1" },
    cseg_nsps_so_class: { id: salesChannelId },
    salesRep: { id: "-5" },
    salesTeam,
    shipcomplete: shipComplete,
    trandate,
    ...(billingTermsId ? { terms: { id: billingTermsId } } : {}),
    custbody_hpl_hs_deal_name: dealName,
    ...(orderNotes != null
      ? { custbody_hpl_ordernote: String(orderNotes) }
      : {}),
    ...(soReference !== undefined
      ? { custbody_hpl_so_reference: String(soReference) }
      : {}),
    ...(affiliateId ? { partner: { id: affiliateId } } : {}),
    ...(affiliateId
      ? {
          partners: {
            replaceAll: true,
            items: [
              {
                partner: { id: affiliateId },
                isPrimary: true,
                // partnerRole is optional; skip unless you set DEFAULT_PARTNER_ROLE_ID
                // ...(DEFAULT_PARTNER_ROLE_ID ? { partnerRole: { id: DEFAULT_PARTNER_ROLE_ID } } : {}),
              },
            ],
          },
        }
      : {}),
    item: {
      replaceAll: false,
      items: lineItems.map((item) => ({
        item: { id: item.itemId },
        quantity: item.quantity,
        rate: item.unitPrice * (1 - item.unitDiscount / 100),
        custcolns_comment: item.comment || "",
      })),
    },
  };
}

async function getExistingOrderState(soId: string, token: string) {
  const res = await axios.get(
    `${BASE_URL}/record/v1/salesOrder/${soId}?expandSubResources=true`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    }
  );

  const existingLineMap: Record<string, string[]> = {};
  const fulfilledLines = new Set<string>();

  for (const line of res.data.item?.items || []) {
    const itemId = line.item?.id;
    const lineId = line.line;
    if (itemId && lineId) {
      if (line.fulfillmentstatus === "FULFILLED") fulfilledLines.add(itemId);
      else {
        if (!existingLineMap[itemId]) existingLineMap[itemId] = [];
        existingLineMap[itemId].push(lineId);
      }
    }
  }

  return {
    existingLineMap,
    fulfilledLines,
    existingSalesTeam: res.data.salesTeam?.items || [],
  };
}

function buildPatchLines(lineItems, existingLineMap, fulfilledLines) {
  const usedLineIds = new Set<string>();
  const patchedLineIdMap: Record<string, string> = {};

  const filteredLines = lineItems
    .filter((item) => !fulfilledLines.has(item.itemId))
    .map((item) => {
      const base = item.isClosed
        ? {
            item: { id: item.itemId },
            quantity: 0,
            rate: 0,
            amount: 0,
            isClosed: true,
          }
        : {
            item: { id: item.itemId },
            quantity: item.quantity,
            rate: item.unitPrice * (1 - item.unitDiscount / 100),
            custcolns_comment: item.comment,
          };

      const lineIdList = existingLineMap[item.itemId];
      if (lineIdList?.length) {
        const lineId = lineIdList.shift();
        if (lineId && !usedLineIds.has(lineId)) {
          usedLineIds.add(lineId);
          patchedLineIdMap[item.itemId] = lineId;
          return { ...base, line: lineId };
        }
      }

      return base;
    });

  return { filteredLines, patchedLineIdMap };
}

async function syncInvoicesWithSalesOrder(soId, lineIdMap, lineItems, token) {
  for (const [itemId, previousLineId] of Object.entries(lineIdMap)) {
    const invoices = await getInvoicesForSalesOrder(soId);
    const invoiceId = invoices?.[0]?.id;
    if (!invoiceId) continue;

    const result = await getInvoiceLineId({
      invoiceId: Number(invoiceId),
      salesOrderId: Number(soId),
      previousLineId: Number(previousLineId),
    });

    if (!result) continue;

    const updatedItem = lineItems.find((i) => i.itemId === itemId);
    if (!updatedItem) continue;

    const expectedQty = updatedItem.quantity;
    const expectedRate =
      updatedItem.unitPrice * (1 - updatedItem.unitDiscount / 100);

    const invoiceQty = Math.abs(Number(result.quantity));
    const invoiceRate = Math.abs(Number(result.rate));

    if (invoiceQty !== expectedQty || invoiceRate !== expectedRate) {
      await axios.patch(
        `${BASE_URL}/record/v1/invoice/${invoiceId}`,
        {
          item: {
            replaceAll: false,
            items: [
              {
                line: Number(result.invoicelineid),
                item: { id: result.itemid },
                quantity: expectedQty,
                rate: expectedRate,
              },
            ],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
    }
  }
}

function cleanSalesTeam(existingTeam, newTeam) {
  const idMap = new Map(existingTeam.map((m) => [m.employee?.id ?? "", m.id]));
  return newTeam
    .filter((m) => m.contribution > 0)
    .map((m) => ({
      ...(idMap.has(m.employee.id) ? { id: idMap.get(m.employee.id) } : {}),
      employee: { id: m.employee.id },
      isPrimary: m.isPrimary,
      contribution: m.contribution,
    }));
}

async function clearSalesTeam(soId, token) {
  await axios.patch(
    `${BASE_URL}/record/v1/salesOrder/${soId}?replace=salesTeam`,
    { salesTeam: { items: [] } },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }
  );
}

// async function applySalesOrderPatch(
//   soId,
//   items,
//   team,
//   shipComplete,
//   token,
//   salesChannelId,
//   affiliateId
// ) {
//   const body: any = {
//     shipcomplete: shipComplete,
//     cseg_nsps_so_class: { id: salesChannelId },
//     salesTeam: { replaceAll: true, items: team },
//     item: { replaceAll: false, items },
//   };
//   if (affiliateId) {
//     body.partner = { id: affiliateId };
//   } else {
//     body.fieldsToNull = ["partner"];
//   }
//   await axios.patch(`${BASE_URL}/record/v1/salesOrder/${soId}`, body, {
//     headers: {
//       Authorization: `Bearer ${token}`,
//       Accept: "application/json",
//       "Content-Type": "application/json",
//     },
//   });
// }

async function applySalesOrderPatch(
  soId: string,
  items: any[],
  team: any[],
  shipComplete: boolean,
  token: string,
  salesChannelId: string,
  affiliateId: string | null,
  trandate?: string,
  dealName?: string | null,
  orderNotes?: string | null,
  billingTermsId?: string | null,
  soReference?: string | ""
) {
  // const body: any = {
  //   shipcomplete: shipComplete,
  //   cseg_nsps_so_class: { id: salesChannelId },
  //   salesTeam: { replaceAll: true, items: team },
  //   item: { replaceAll: false, items },
  // };
  const body: any = {
    shipcomplete: shipComplete,
    cseg_nsps_so_class: { id: salesChannelId },
    salesTeam: { replaceAll: true, items: team },
    item: { replaceAll: false, items },

    partner: affiliateId ? { id: affiliateId } : null,
    partners: {
      replaceAll: true,
      items: affiliateId
        ? [{ partner: { id: affiliateId }, isPrimary: true }]
        : [],
    },
  };
  if (trandate) {
    console.log("[PATCH SO] setting trandate =", trandate);
    body.trandate = trandate;
  }
  if (typeof dealName === "string" && dealName.length > 0) {
    body.custbody_hpl_hs_deal_name = dealName;
  }
  console.log("Xxxxxxxx", orderNotes);
  if (orderNotes !== undefined) {
    const text = String(orderNotes ?? "").trim();
    if (text) {
      body.custbody_hpl_ordernote = orderNotes;
    } else {
      body.custbody_hpl_ordernote = "";
    }
  }
  if (billingTermsId !== undefined) {
    if (billingTermsId) {
      body.terms = { id: billingTermsId };
    }
  }
  if (soReference !== undefined) {
    const text = String(soReference ?? "").trim();
    body.custbody_hpl_so_reference = text ? text : "";
  }
  console.log("sending body", body);

  const url = `${BASE_URL}/record/v1/salesOrder/${soId}`;

  await axios.patch(url, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
}

async function createNewSalesOrder(payload, token) {
  const hubspotSoId = payload?.custbodyhs_so_id;
  const agent = new https.Agent({ keepAlive: false });
  try {
    await axios.post(`${BASE_URL}/record/v1/salesOrder`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 90_000,
      httpsAgent: agent,
    });
  } catch (e: any) {
    if (!e.response || e.code === "ECONNRESET" || e.code === "ECONNABORTED") {
      if (hubspotSoId) {
        const id = await findSalesOrderByHubspotSoId(hubspotSoId, token);
        if (id) return { id, created: true }; // request succeeded server-side
      }
    }
    throw e;
  }
}

async function fetchTranIdFromSO(id, token) {
  const res = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    {
      q: `SELECT id, tranid FROM transaction WHERE type = 'SalesOrd' AND id = ${id}`,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
    }
  );
  return res.data.items?.[0]?.tranid;
}

function handleNetsuiteError(error: any) {
  console.error("Failed to create/update Sales Order");
  if (error.response) {
    console.error("Status:", error.response.status);
    console.error("Data:", JSON.stringify(error.response.data, null, 2));
  } else if (error.request) {
    console.error("No response received:", error.request);
  } else {
    console.error("Error setting up request:", error.message);
  }
  console.log("Unkown error details", error);
  throw new Error(
    error.response?.data?.title ||
      error.message ||
      error ||
      "Unknown error from NetSuite"
  );
}

async function findCustomerByHubspotId(hsId: string, token: string) {
  const q = `SELECT id FROM customer WHERE custentity_hpl_hs_id = '${hsId}'`;
  const res = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    { q },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
    }
  );
  return res.data.items?.[0]?.id || null;
}

async function findSalesOrderByHubspotSoId(soId: string, token: string) {
  const q = `SELECT id FROM transaction WHERE type = 'SalesOrd' AND custbodyhs_so_id = '${soId}'`;
  const res = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    { q },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
    }
  );
  return res.data.items?.[0]?.id || null;
}

async function clearPartners(soId: string, token: string) {
  await axios.patch(
    `${BASE_URL}/record/v1/salesOrder/${soId}?replace=partners`,
    { partners: { items: [] } },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }
  );
}

// --- Date helpers (safe defaults) ---
function todayInEasternYYYYMMDD(): string {
  // 'en-CA' yields YYYY-MM-DD;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalizeDateInput(d?: string | null): string | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d).trim());
  if (!m) return null;
  const y = +m[1],
    mo = +m[2],
    da = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, da));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== mo ||
    dt.getUTCDate() !== da
  )
    return null; // invalid date
  return `${m[1]}-${m[2]}-${m[3]}`;
}
