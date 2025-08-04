import { NextRequest } from "next/server";
import axios from "axios";

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN!;
const hubspot = axios.create({
  baseURL: "https://api.hubapi.com",
  headers: {
    Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    "Content-Type": "application/json",
  },
});

//Get: Fetching Line items to keep frontend up to date
// export async function GET(req: NextRequest) {
//   const { searchParams } = new URL(req.url!);
//   const dealId = searchParams.get("dealId");

//   if (!dealId) {
//     return new Response(JSON.stringify({ error: "Missing dealId" }), {
//       status: 400,
//     });
//   }

//   try {
//     // 1. Fetch associated line items
//     const associations = await hubspot.get(
//       `/crm/v3/objects/deals/${dealId}/associations/line_items`
//     );

//     const lineItemIds = associations.data.results.map((r: any) => r.id);

//     if (lineItemIds.length === 0) {
//       return new Response(JSON.stringify([]), { status: 200 });
//     }

//     // 2. Fetch with all discount-related properties
//     const lineItemDetails = await hubspot.post(
//       `/crm/v3/objects/line_items/batch/read`,
//       {
//         properties: [
//           "hs_product_id",
//           "quantity",
//           "hs_sku",
//           "discount", // flat per-unit discount
//           "hs_discount_percentage", // % discount
//           "hs_total_discount", // calculated total discount
//           "hs_pre_discount_amount", // original price before discount
//         ],
//         inputs: lineItemIds.map((id: string) => ({ id })),
//       }
//     );

//     console.log(" Raw line item properties:");
//     lineItemDetails.data.results.forEach((item: any) => {
//       console.log(`LineItem ${item.id}:`, item.properties);
//     });

//     const items = lineItemDetails.data.results.map((item: any) => ({
//       id: item.id,
//       quantity: Number(item.properties.quantity),
//       productId: item.properties.hs_product_id,
//       sku: item.properties.hs_sku,
//       discountFlat: Number(item.properties.discount) || 0,
//       discountPercent: Number(item.properties.hs_discount_percentage) || 0,
//       totalDiscount: Number(item.properties.hs_total_discount) || 0,
//       preDiscountAmount: Number(item.properties.hs_pre_discount_amount) || 0,
//     }));

//     // 3. Get associated product names and prices
//     const productIds = items.map((i) => i.productId);
//     const productDetails = await hubspot.post(
//       `/crm/v3/objects/products/batch/read`,
//       {
//         properties: ["name", "price", "sku", "ns_item_id"],
//         inputs: productIds.map((id: string) => ({ id })),
//       }
//     );

//     const productMap: Record<string, any> = {};
//     productDetails.data.results.forEach((p: any) => {
//       productMap[p.id] = {
//         ...p.properties,
//         ns_item_id: p.properties.ns_item_id, //  explicitly carry this over
//       };
//     });

//     const final = items.map((item: any) => {
//       const product = productMap[item.productId] || {};
//       const unitPrice = Number(product.price) || 0;

//       return {
//         id: item.id,
//         sku: item.sku || product.sku,
//         productName: product.name,
//         quantity: item.quantity,
//         unitPrice,
//         total: unitPrice * item.quantity,
//         lineItemId: item.id,
//         ns_item_id: product.ns_item_id,
//         productId: item.productId,
//         unitDiscount: item.discountFlat || item.discountPercent || 0,
//         totalDiscount: item.totalDiscount,
//         preDiscountAmount: item.preDiscountAmount,
//         discountType: item.discountFlat
//           ? "flat"
//           : item.discountPercent
//           ? "percent"
//           : "none",
//       };
//     });

//     return new Response(JSON.stringify(final), { status: 200 });
//   } catch (err: any) {
//     console.error(
//       "Line item fetch failed:",
//       err?.response?.data || err.message
//     );
//     return new Response(JSON.stringify({ error: "Fetch failed" }), {
//       status: 500,
//     });
//   }
// }
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url!);
  const dealId = searchParams.get("dealId");

  if (!dealId) {
    return new Response(JSON.stringify({ error: "Missing dealId" }), {
      status: 400,
    });
  }

  try {
    // 1. Fetch associated line items
    const associations = await hubspot.get(
      `/crm/v3/objects/deals/${dealId}/associations/line_items`
    );

    const lineItemIds = associations.data.results.map((r: any) => r.id);
    if (lineItemIds.length === 0) {
      return new Response(JSON.stringify([]), { status: 200 });
    }

    // 2. Fetch line item details
    const lineItemDetails = await hubspot.post(
      `/crm/v3/objects/line_items/batch/read`,
      {
        properties: [
          "hs_product_id",
          "quantity",
          "hs_sku",
          "discount",
          "hs_discount_percentage",
          "hs_total_discount",
          "hs_pre_discount_amount",
          "ns_item_id",
          "name",
        ],
        inputs: lineItemIds.map((id: string) => ({ id })),
      }
    );

    const items = lineItemDetails.data.results.map((item: any) => {
      console.log(
        ` LineItem ${item.id} → ns_item_id: ${item.properties.ns_item_id}`
      );

      return {
        id: item.id,
        quantity: Number(item.properties.quantity),
        productId: item.properties.hs_product_id,
        sku: item.properties.hs_sku,
        discountFlat: Number(item.properties.discount) || 0,
        discountPercent: Number(item.properties.hs_discount_percentage) || 0,
        totalDiscount: Number(item.properties.hs_total_discount) || 0,
        preDiscountAmount: Number(item.properties.hs_pre_discount_amount) || 0,
        ns_item_id: item.properties.ns_item_id || null,
        deletedProductName: item.properties.name || null,
      };
    });

    // 3. Try to fetch associated products by hs_product_id
    const productIds = items.map((i) => i.productId).filter(Boolean);
    let productMap: Record<string, any> = {};

    if (productIds.length > 0) {
      const productDetails = await hubspot.post(
        `/crm/v3/objects/products/batch/read`,
        {
          properties: ["name", "price", "sku", "ns_item_id"],
          inputs: productIds.map((id: string) => ({ id })),
        }
      );

      productMap = {};
      productDetails.data.results.forEach((p: any) => {
        productMap[p.id] = p.properties;
      });
    }

    const results = await Promise.all(
      items.map(async (item) => {
        let product = productMap[item.productId];
        let productId = item.productId;

        //  If missing, fallback using ns_item_id (parsed from SKU if needed)
        if (!product && item.ns_item_id) {
          try {
            console.log(
              ` Attempting fallback using ns_item_id: ${item.ns_item_id}`
            );

            const fallbackRes = await hubspot.post(
              `/crm/v3/objects/products/search`,
              {
                filterGroups: [
                  {
                    filters: [
                      {
                        propertyName: "ns_item_id",
                        operator: "EQ",
                        value: item.ns_item_id,
                      },
                    ],
                  },
                ],
                properties: ["name", "price", "sku", "ns_item_id"],
                limit: 1,
              }
            );

            const match = fallbackRes?.data?.results?.[0];
            if (match) {
              product = match.properties;
              productId = match.id;

              console.log(
                ` Fallback resolved → hs_product_id: ${productId}, name: ${product.name}`
              );
            } else {
              console.warn(
                ` No product found for ns_item_id = ${item.ns_item_id}`
              );
            }
          } catch (err) {
            console.error(
              ` Fallback via ns_item_id failed for ${item.id}`,
              err?.response?.data || err.message
            );
          }
        }
        //  If productId changed due to fallback, update the line item to rebind it
        if (item.productId !== productId && item.id) {
          console.log(
            ` Updating orphaned line item ${item.id} → hs_product_id = ${productId}`
          );

          try {
            await hubspot.patch(`/crm/v3/objects/line_items/${item.id}`, {
              properties: {
                hs_product_id: productId,
              },
            });
          } catch (patchErr) {
            console.error(
              `Failed to patch orphaned line item ${item.id}:`,
              patchErr
            );
          }
        }

        const fallbackUnitPrice = item.preDiscountAmount / item.quantity || 0;

        return {
          id: item.id,
          sku: item.sku || product?.sku || "(unknown)",
          productName:
            product?.name ||
            `[Deleted] ${item.deletedProductName}` ||
            "(Deleted product)",
          quantity: item.quantity,
          unitPrice:
            product?.price != null ? Number(product.price) : fallbackUnitPrice,
          total:
            (product?.price != null
              ? Number(product.price)
              : fallbackUnitPrice) * item.quantity,
          lineItemId: item.id,
          ns_item_id: product?.ns_item_id || null,
          productId, //  healed value (original or remapped via ns_item_id)
          unitDiscount: item.discountFlat || item.discountPercent || 0,
          totalDiscount: item.totalDiscount,
          preDiscountAmount: item.preDiscountAmount,
          discountType: item.discountFlat
            ? "flat"
            : item.discountPercent
            ? "percent"
            : "none",
        };
      })
    );

    return new Response(JSON.stringify(results), { status: 200 });
  } catch (err: any) {
    console.error(
      "Line item fetch failed:",
      err?.response?.data || err.message
    );
    return new Response(JSON.stringify({ error: "Fetch failed" }), {
      status: 500,
    });
  }
}

// POST: update Line items
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dealId, selectedProducts } = body;

    if (!dealId || !Array.isArray(selectedProducts)) {
      return new Response(
        JSON.stringify({ error: "Missing dealId or selectedProducts[]" }),
        { status: 400 }
      );
    }

    console.log(" Syncing line items for deal", dealId);
    const results: any[] = [];

    for (const product of selectedProducts) {
      const quantity = (product.quantity || 1).toString();
      const price = product.unitPrice?.toString();

      if (product.lineItemId) {
        const unitDiscountPercent = Number(
          product.unitDiscount ?? 0
        ).toString();
        console.log("From Post", product.unitDiscount ?? 0);

        await hubspot.patch(
          `/crm/v3/objects/line_items/${product.lineItemId}`,
          {
            properties: {
              quantity,
              price,
              hs_discount_percentage: unitDiscountPercent,
            },
          }
        );

        console.log(`  Updated line item ${product.lineItemId}`);
        results.push({
          ns_item_id: product.id,
          lineItemId: product.lineItemId,
          updated: true,
        });
      } else {
        // 🔍 Fallback: find HubSpot product by ns_item_id
        const searchPayload = {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "ns_item_id",
                  operator: "EQ",
                  value: product.id?.toString(),
                },
              ],
            },
          ],
          properties: ["name", "price", "ns_item_id"],
          limit: 1,
        };

        const res = await hubspot.post(
          "/crm/v3/objects/products/search",
          searchPayload
        );
        const match = res.data.results?.[0];
        if (!match) {
          results.push({ ns_item_id: product.id, matched: false });
          continue;
        }

        const hubspotProductId = match.id;

        const unitDiscountPercent = Number(
          product.unitDiscount ?? 0
        ).toString();

        const created = await hubspot.post("/crm/v3/objects/line_items", {
          properties: {
            hs_product_id: hubspotProductId,
            quantity,
            price,
            hs_discount_percentage: unitDiscountPercent,
          },
        });

        await hubspot.put(
          `/crm/v3/objects/line_items/${created.data.id}/associations/deals/${dealId}/line_item_to_deal`
        );

        console.log(
          `  Created line item ${created.data.id} and associated to deal ${dealId}`
        );

        results.push({
          ns_item_id: product.id,
          matched: true,
          hs_id: hubspotProductId,
          lineItemId: created.data.id,
          created: true,
        });
      }
    }

    return new Response(
      JSON.stringify({ message: "Line items synced", results }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error(
      " HubSpot Product Sync Error:",
      err?.response?.data || err.message
    );
    return new Response(JSON.stringify({ error: "HubSpot sync failed" }), {
      status: 500,
    });
  }
}

// DELETE: Remove a specific line item from a deal
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url!);
    const lineItemId = searchParams.get("lineItemId");

    if (!lineItemId) {
      return new Response(JSON.stringify({ error: "Missing lineItemId" }), {
        status: 400,
      });
    }

    await hubspot.post(`/crm/v3/objects/line_items/batch/archive`, {
      inputs: [{ id: lineItemId }],
    });

    console.log(` Deleted line item ${lineItemId}`);
    return new Response(
      JSON.stringify({ message: `Line item ${lineItemId} deleted` }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error(" Failed to delete line item:", err?.response?.data || err);
    return new Response(
      JSON.stringify({ error: "Failed to delete line item" }),
      { status: 500 }
    );
  }
}
