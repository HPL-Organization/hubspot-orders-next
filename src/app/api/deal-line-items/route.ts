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
const BILLING_TERMS: Record<string, string> = {
  "2": "Net 30",
  "7": "Paid before shipped",
};
const normalizeBillingTermsId = (v: any) => {
  const s = String(v ?? "").trim();
  return s === "2" || s === "7" ? s : "";
};

//Get: Fetching Line items to keep frontend up to date
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url!);
  const dealId = searchParams.get("dealId");

  if (!dealId) {
    return new Response(JSON.stringify({ error: "Missing dealId" }), {
      status: 400,
    });
  }

  try {
    const dealResp = await hubspot.get(`/crm/v3/objects/deals/${dealId}`, {
      params: {
        properties:
          "sales_channel,sales_channel_id,affiliate_id,affiliate_name,hpl_ns_so_date,dealname,hpl_order_notes,hpl_ns_terms",
      },
    });
    const dealProps = dealResp.data?.properties ?? {};
    const salesChannel = dealProps.sales_channel ?? null;
    const salesChannelId = dealProps.sales_channel_id ?? null;
    const affiliateId = dealProps.affiliate_id ?? null;
    const affiliateName = dealProps.affiliate_name ?? null;
    const salesOrderDate = dealProps.hpl_ns_so_date ?? null;
    const dealName = dealProps.dealname ?? null;
    const orderNotes = dealProps.hpl_order_notes ?? "";
    const billingTermsIdRaw = dealProps.hpl_ns_terms ?? "";
    const billingTermsId = normalizeBillingTermsId(billingTermsIdRaw);
    const billingTermsLabel = billingTermsId
      ? BILLING_TERMS[billingTermsId]
      : null;
    // 1. Fetch associated line items
    const associations = await hubspot.get(
      `/crm/v3/objects/deals/${dealId}/associations/line_items`
    );

    const lineItemIds = associations.data.results.map((r: any) => r.id);
    if (lineItemIds.length === 0) {
      return new Response(
        JSON.stringify({
          items: [],
          salesChannel,
          salesChannelId,
          affiliateId,
          affiliateName,
          salesOrderDate,
          dealName,
          orderNotes,
          billingTermsId,
          billingTermsLabel,
        }),
        {
          status: 200,
        }
      );
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
          properties: ["name", "sku", "ns_item_id"],
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

    return new Response(
      JSON.stringify({
        items: results,
        salesChannel,
        salesChannelId,
        affiliateId,
        affiliateName,
        dealName,
        salesOrderDate,
        orderNotes,
        billingTermsId,
        billingTermsLabel,
      }),
      {
        status: 200,
      }
    );
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
    const {
      dealId,
      selectedProducts,
      salesChannel,
      affiliate,
      salesOrderDate,
      orderNotes,
      billingTermsId,
    } = body;

    if (!dealId || !Array.isArray(selectedProducts)) {
      return new Response(
        JSON.stringify({ error: "Missing dealId or selectedProducts[]" }),
        { status: 400 }
      );
    }
    if (salesChannel) {
      await hubspot.patch(`/crm/v3/objects/deals/${dealId}`, {
        properties: {
          sales_channel: salesChannel.value,
          sales_channel_id: salesChannel.id,
        },
      });
      console.log(`  Updated deal ${dealId} sales_channel = "${salesChannel}"`);
    }

    if (affiliate) {
      await hubspot.patch(`/crm/v3/objects/deals/${dealId}`, {
        properties: {
          affiliate_id: String(affiliate.id),
          affiliate_name: affiliate.name,
        },
      });
      console.log(
        `  Updated deal ${dealId} affiliate_id=${affiliate.id} affiliate_name="${affiliate.name}"`
      );
    } else if (affiliate === null) {
      await hubspot.patch(`/crm/v3/objects/deals/${dealId}`, {
        properties: { affiliate_id: "", affiliate_name: "" },
      });
    }
    console.log("sales order date check", salesOrderDate);
    if (salesOrderDate !== undefined) {
      const isYMD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
      const value =
        typeof salesOrderDate === "string" && isYMD(salesOrderDate)
          ? salesOrderDate
          : "";

      try {
        await hubspot.patch(`/crm/v3/objects/deals/${dealId}`, {
          properties: { hpl_ns_so_date: value },
        });
        console.log(`  Updated deal ${dealId} hpl_ns_so_date="${value}"`);
      } catch (e: any) {
        console.warn(
          "Warning: failed to set hpl_ns_so_date (property may not exist):",
          e?.response?.data || e?.message
        );
      }
    }
    if (orderNotes !== undefined) {
      const notesStr = orderNotes === null ? "" : String(orderNotes);
      try {
        await hubspot.patch(`/crm/v3/objects/deals/${dealId}`, {
          properties: { hpl_order_notes: notesStr },
        });
        console.log(
          `  Updated deal ${dealId} hpl_order_notes (${notesStr.length} chars)`
        );
      } catch (e: any) {
        console.warn(
          "Warning: failed to set hpl_order_notes (property may not exist):",
          e?.response?.data || e?.message
        );
      }
    }
    if (billingTermsId !== undefined) {
      const cleaned = normalizeBillingTermsId(billingTermsId);
      try {
        await hubspot.patch(`/crm/v3/objects/deals/${dealId}`, {
          properties: { hpl_ns_terms: cleaned },
        });
        console.log(`  Updated deal ${dealId} hpl_ns_terms="${cleaned}"`);
      } catch (e: any) {
        console.warn(
          "Warning: failed to set hpl_billing_terms_id (property may not exist):",
          e?.response?.data || e?.message
        );
      }
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
        //  Fallback: find HubSpot product by ns_item_id
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
