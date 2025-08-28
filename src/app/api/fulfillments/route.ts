import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "../../../../lib/netsuite/token";

// NetSuite REST base URL

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("internalId");
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing internalId" }), {
      status: 400,
    });
  }

  try {
    //  Get valid OAuth token
    const token = await getValidToken();

    //  Fetch item fulfillments linked to this sales order
    const fulfillmentQuery = `
      SELECT
        T.ID,
        T.TranID,
        T.TranDate
      FROM
        Transaction T
        INNER JOIN PreviousTransactionLineLink PTLL ON PTLL.NextDoc = T.ID
        INNER JOIN Transaction SO ON SO.ID = PTLL.PreviousDoc
      WHERE
        T.Type = 'ItemShip'
        AND SO.Type = 'SalesOrd'
        AND SO.ID = ${id}
    `;

    const fulfillmentRes = await axios.post(
      `${BASE_URL}/query/v1/suiteql`,
      { q: fulfillmentQuery },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          Prefer: "transient",
        },
      }
    );

    // 🧹 Deduplicate fulfillments by ID
    const uniqueFulfillments = Array.from(
      new Map(
        fulfillmentRes.data.items.map((item: any) => [item.id, item])
      ).values()
    );

    //  For each fulfillment, get items and tracking info
    const fulfillmentsWithItems = await Promise.all(
      uniqueFulfillments.map(async (item: any) => {
        //  Query all items in the fulfillment
        const lineItemQuery = `
          SELECT
            TL.Transaction AS FulfillmentId,
            I.ItemId AS ItemSKU,
            I.DisplayName AS ItemDisplayName,
            TL.Quantity
          FROM
            TransactionLine TL
            INNER JOIN Item I ON I.ID = TL.Item
          WHERE
            TL.Transaction = ${item.id}
        `;

        const lineRes = await axios.post(
          `${BASE_URL}/query/v1/suiteql`,
          { q: lineItemQuery },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "Content-Type": "application/json",
              Prefer: "transient",
            },
          }
        );

        //  Get tracking numbers from fulfillment record
        let trackingNumber = "";
        let shipStatus = "";
        let fulfillmentStatus = "";

        try {
          const detailRes = await axios.get(
            `${BASE_URL}/record/v1/itemFulfillment/${item.id}?expandSubResources=true`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
              },
            }
          );

          console.log(` Fulfillment detail for ${item.id}:`, detailRes.data);

          // Save shipStatus and fulfillment status for frontend
          shipStatus = detailRes.data.shipStatus?.refName || "";
          fulfillmentStatus = detailRes.data.status?.refName || "";

          // Try known paths for package tracking
          const packagesRaw =
            detailRes.data.packageList?.packages ??
            detailRes.data.packageList ??
            detailRes.data.packages ??
            [];

          console.log(` Raw packages for ${item.id}:`, packagesRaw);

          if (Array.isArray(packagesRaw)) {
            trackingNumber = packagesRaw
              .map((pkg: any) => pkg.packageTrackingNumber)
              .filter(Boolean)
              .join(", ");
            console.log(
              ` Found tracking from array for ${item.id}:`,
              trackingNumber
            );
          } else if (packagesRaw?.packageTrackingNumber) {
            trackingNumber = packagesRaw.packageTrackingNumber;
            console.log(
              ` Found tracking from single object for ${item.id}:`,
              trackingNumber
            );
          }

          // Fallback: scan all fields
          if (!trackingNumber) {
            const allTrackingFields = findTrackingNumbers(detailRes.data);
            console.log(
              ` Fallback scan tracking fields for ${item.id}:`,
              allTrackingFields
            );
            if (allTrackingFields.length) {
              trackingNumber = allTrackingFields.join(", ");
              console.log(
                ` Used fallback scan for ${item.id}:`,
                trackingNumber
              );
            }
          }
        } catch (fallbackErr: any) {
          console.warn(
            ` Failed record API tracking for ${item.id}`,
            fallbackErr?.response?.data || fallbackErr?.message
          );
        }

        //  Group items by SKU and name, and calculate total quantity
        const grouped = new Map<
          string,
          { sku: string; productName: string; quantity: number }
        >();

        for (const line of lineRes.data.items) {
          const key = `${line.itemsku}::${line.itemdisplayname}`;
          if (!grouped.has(key)) {
            grouped.set(key, {
              sku: line.itemsku,
              productName: line.itemdisplayname,
              quantity: Math.abs(parseFloat(line.quantity)),
            });
          }
        }

        //  Return final items with tracking attached
        const items = Array.from(grouped.values()).map((line) => ({
          ...line,
          tracking: trackingNumber,
        }));

        return {
          id: item.id,
          number: item.tranid,
          shippedAt: item.trandate,
          shipStatus,
          status: fulfillmentStatus,
          items,
        };
      })
    );

    //  Return all fulfillments with their items and tracking numbers
    return new Response(
      JSON.stringify({ fulfillments: fulfillmentsWithItems }),
      {
        status: 200,
      }
    );
  } catch (error: any) {
    console.error(
      " Failed to fetch fulfillments:",
      error.response?.data || error.message
    );
    return new Response(
      JSON.stringify({ error: "Failed to fetch fulfillments" }),
      { status: 500 }
    );
  }
}

//  Recursively find all string fields that include "tracking" in their key
function findTrackingNumbers(obj: any): string[] {
  const results: string[] = [];

  function recurse(o: any) {
    if (o && typeof o === "object") {
      for (const key in o) {
        if (
          key.toLowerCase().includes("tracking") &&
          typeof o[key] === "string"
        ) {
          results.push(o[key]);
        } else if (typeof o[key] === "object") {
          recurse(o[key]);
        }
      }
    }
  }

  recurse(obj);
  return results;
}
