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

  const itemLines = lineItems.map((item) => ({
    item: { id: item.itemId },
    quantity: item.quantity,
    rate: item.unitPrice * (1 - item.unitDiscount / 100),
  }));

  const payload = {
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
      items: itemLines,
    },
  };

  console.log("payload from backend", payload.salesTeam.items);

  try {
    if (existingSOId) {
      console.log(` Updating existing Sales Order ${existingSOId}`);

      //  Fetch existing SO line items
      const existingLineMap: Record<string, string[]> = {};
      const fulfilledLines = new Set<string>();
      const getResp = await axios.get(
        `${BASE_URL}/record/v1/salesOrder/${existingSOId}?expandSubResources=true`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }
      );
      // process existing sales team

      const existingSalesTeamMap: Record<string, string> = {}; // employeeId -> internalId

      for (const member of getResp.data.salesTeam?.items || []) {
        const empId = member.employee?.id;
        const internalId =
          member.internalId ||
          member["internalId"] ||
          member["@ref"] ||
          member.id;

        console.log(`EMP ID ${empId} → Internal ID ${internalId}`);

        if (empId && internalId && !internalId.startsWith(existingSOId)) {
          existingSalesTeamMap[empId] = internalId;
        }
      }

      //process existing line items
      for (const line of getResp.data.item?.items || []) {
        const itemId = line.item?.id;
        const lineId = line.line;
        const status = line.fulfillmentstatus;

        if (itemId && lineId) {
          if (status === "FULFILLED") {
            fulfilledLines.add(itemId);
          } else {
            if (!existingLineMap[itemId]) existingLineMap[itemId] = [];
            existingLineMap[itemId].push(lineId);
          }
        }
      }
      const patchedLineIdMap: Record<string, string> = {};

      //  Reconstruct itemLines for update only (skip fulfilled)
      const usedLineIds = new Set<string>();

      const filteredLines = lineItems
        .filter((item) => !fulfilledLines.has(item.itemId))
        .map((item) => {
          const isClosing = item.isClosed === true;

          const base = isClosing
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
          if (lineIdList && lineIdList.length > 0) {
            const lineId = lineIdList.shift();
            if (lineId && !usedLineIds.has(lineId)) {
              usedLineIds.add(lineId);
              patchedLineIdMap[item.itemId] = lineId;
              const lineItem = { ...base, line: lineId };
              console.log("✅ LineItem PATCH →", JSON.stringify(lineItem));
              return { ...base, line: lineId };
            }
          }
          console.log("✅ NEW LineItem (no line ref) →", JSON.stringify(base));

          return base;
        });

      //invoice sync logic based on sales line item

      for (const [itemId, previousLineId] of Object.entries(patchedLineIdMap)) {
        console.log(
          ` Attempting invoice lookup for item ${itemId} → SO line ${previousLineId}`
        );

        const invoices = await getInvoicesForSalesOrder(existingSOId);
        const invoiceId = invoices?.[0]?.id;

        if (!invoiceId) {
          console.warn(` No invoice found for SO ${existingSOId}`);
          continue;
        }

        const result = await getInvoiceLineId({
          invoiceId: Number(invoiceId),
          salesOrderId: Number(existingSOId),
          previousLineId: Number(previousLineId),
        });

        if (result) {
          console.log(` Invoice Line Sync for item ${itemId}:`, result);
          const invoiceLineId = result.invoicelineid;
          const invoiceItemId = result.itemid;
          const invoiceQty = Math.abs(Number(result.quantity));
          const invoiceRate = Math.abs(Number(result.rate));

          const updatedItem = lineItems.find((i) => i.itemId === itemId);
          if (!updatedItem) continue;

          const expectedQty = updatedItem.quantity;
          const expectedRate =
            updatedItem.unitPrice * (1 - updatedItem.unitDiscount / 100);

          const quantityMismatch = invoiceQty !== expectedQty;
          const rateMismatch = invoiceRate !== expectedRate;

          if (quantityMismatch || rateMismatch) {
            console.log(
              ` Updating Invoice Line: ${invoiceLineId} for item ${itemId}`
            );
            await axios.patch(
              `${BASE_URL}/record/v1/invoice/${invoiceId}`,
              {
                item: {
                  replaceAll: false,
                  items: [
                    {
                      line: Number(invoiceLineId),
                      item: { id: invoiceItemId },
                      quantity: expectedQty,
                      rate: expectedRate,
                    },
                  ],
                },
              },
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
              }
            );
          } else {
            console.log(
              "Invoice already in sync for Invoice LI",
              invoiceLineId
            );
          }
        } else {
          console.log(` No matching invoice line found for item ${itemId}`);
        }
      }

      //  Rebuild sales team to avoid NetSuite 110% error
      const existingSalesTeam = getResp.data.salesTeam?.items || [];

      // Create a map of existing employeeId → internalId
      const existingIdMap = new Map<string, string>(
        existingSalesTeam.map((line) => [line.employee?.id ?? "", line.id])
      );

      // Create a map of new employeeId → object
      const newIdMap = new Map(salesTeam.items.map((m) => [m.employee.id, m]));

      const cleanedSalesTeam = salesTeam.items
        .filter((m) => m.contribution > 0)
        .map((m) => ({
          ...(existingIdMap.has(m.employee.id)
            ? { id: existingIdMap.get(m.employee.id) }
            : {}),
          employee: { id: m.employee.id },
          isPrimary: m.isPrimary,
          contribution: m.contribution,
        }));
      //  Only override payload here for update
      const updatePayload = {
        ...payload,
        salesTeam: {
          replaceAll: false,
          items: cleanedSalesTeam,
        },

        item: {
          replaceAll: false,
          items: filteredLines,
        },
      };

      //  Step 1: Wipe existing sales team (Only way I could remove reps with zero contribution)
      await axios.patch(
        `${BASE_URL}/record/v1/salesOrder/${existingSOId}?replace=salesTeam`,
        { salesTeam: { items: [] } },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      //  Step 2: Now reapply updated team with correct values (cleanedSalesTeam already built)
      const response = await axios.patch(
        `${BASE_URL}/record/v1/salesOrder/${existingSOId}`,
        {
          salesTeam: {
            replaceAll: true, // since we just cleared, now we can replace cleanly
            items: cleanedSalesTeam,
          },
          item: {
            replaceAll: false,
            items: filteredLines,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
    } else {
      console.log(" Creating new Sales Order");
      await axios.post(`${BASE_URL}/record/v1/salesOrder`, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      //  Fallback: find created Sales Order ID using HubSpot ID
      const createdId = await findSalesOrderByHubspotSoId(
        hubspotSoId,
        accessToken
      );
      if (!createdId)
        throw new Error("Sales Order was created but ID could not be fetched");
      console.log("****Created internal id***", createdId);
      const suiteqlResp = await axios.post(
        `${BASE_URL}/query/v1/suiteql`,
        {
          q: `SELECT id, tranid FROM transaction WHERE type = 'SalesOrd' AND id = ${createdId}`,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            Prefer: "transient",
          },
        }
      );

      const tranid = suiteqlResp.data.items?.[0]?.tranid;
      console.log(" Fixed: Sales Order Number (tranid) via SuiteQL:", tranid);

      await updateDealWithSalesOrder(hubspotSoId, tranid);
      await updateDealWithSalesOrderInternalId(hubspotSoId, createdId);

      return {
        id: createdId,
        created: true,
        netsuiteTranId: tranid,
      };
    }
  } catch (error: any) {
    console.error(" Failed to create/update Sales Order:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error("No response received:", error.request);
    } else {
      console.error("Error setting up request:", error.message);
    }
    throw new Error(
      error.response?.data?.title || "Unknown error from NetSuite"
    );
  }
}

async function findCustomerByHubspotId(hsId: string, accessToken: string) {
  const suiteQL = `SELECT id FROM customer WHERE custentityhs_id = '${hsId}'`;
  const resp = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    { q: suiteQL },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
    }
  );
  return resp.data.items?.[0]?.id || null;
}

async function findSalesOrderByHubspotSoId(soId: string, accessToken: string) {
  const suiteQL = `SELECT id FROM transaction WHERE type = 'SalesOrd' AND custbodyhs_so_id = '${soId}'`;
  const resp = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    { q: suiteQL },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
    }
  );
  return resp.data.items?.[0]?.id || null;
}
