import axios from "axios";
import { getValidToken } from "./token";
import {
  updateDealWithSalesOrder,
  updateDealWithSalesOrderInternalId,
} from "../HubSpot";
import { getInvoiceLineId } from "./getInvoiceLineId";
import { getInvoicesForSalesOrder } from "./getInvoicesForSalesOrder";

const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

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
  }
) {
  const accessToken = await getValidToken();
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
    shipComplete,
    salesTeam,
    lineItems
  );

  try {
    if (existingSOId) {
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
      await applySalesOrderPatch(
        existingSOId,
        filteredLines,
        cleanedSalesTeam,
        accessToken
      );
    } else {
      await createNewSalesOrder(payload, accessToken);
      const createdId = await findSalesOrderByHubspotSoId(
        hubspotSoId,
        accessToken
      );
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
  lineItems: any[]
) {
  return {
    entity: { id: customerId },
    custbodyhs_so_id: hubspotSoId,
    subsidiary: { id: "2" },
    currency: { id: "1" },
    cseg_nsps_so_class: { id: "13" },
    salesRep: { id: "-5" },
    salesTeam,
    shipcomplete: shipComplete,
    item: {
      replaceAll: false,
      items: lineItems.map((item) => ({
        item: { id: item.itemId },
        quantity: item.quantity,
        rate: item.unitPrice * (1 - item.unitDiscount / 100),
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

async function applySalesOrderPatch(soId, items, team, token) {
  await axios.patch(
    `${BASE_URL}/record/v1/salesOrder/${soId}`,
    {
      salesTeam: { replaceAll: true, items: team },
      item: { replaceAll: false, items },
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

async function createNewSalesOrder(payload, token) {
  await axios.post(`${BASE_URL}/record/v1/salesOrder`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
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
  throw new Error(error.response?.data?.title || "Unknown error from NetSuite");
}

async function findCustomerByHubspotId(hsId: string, token: string) {
  const q = `SELECT id FROM customer WHERE custentityhs_id = '${hsId}'`;
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
