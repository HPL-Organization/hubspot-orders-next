// src/app/api/netsuite/products/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { netsuiteGetAllProductsQL } from "../../../../../lib/netsuite/netsuiteGetAllProductsQL";

function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url!);
  const maxPagesParam = searchParams.get("maxPages") || "Infinity";
  const maxPages = Number(maxPagesParam);
  const supabase = getSupabaseServerClient();

  if (supabase) {
    try {
      const pageSize = 1000;
      const isFinitePages = Number.isFinite(maxPages);
      const maxPageCount = isFinitePages && maxPages > 0 ? maxPages : Infinity;

      let allRows: any[] = [];
      let page = 0;
      let from = 0;

      while (page < maxPageCount) {
        const to = from + pageSize - 1;

        const { data, error } = await supabase
          .from("ns_products")
          .select(
            "netsuite_id, sku, name, description, price, image_url, item_type, raw_item_type, income_account, available"
          )
          .order("netsuite_id", { ascending: true })
          .range(from, to);

        if (error) throw error;

        const rows = data ?? [];
        allRows.push(...rows);

        if (rows.length < pageSize) {
          break;
        }

        page += 1;
        from += pageSize;
      }

      const products =
        allRows
          .map((row: any) => ({
            netsuiteType: "item",
            id: row.netsuite_id,
            sku: row.sku,
            name: row.name,
            description: row.description ?? null,
            price:
              row.price !== undefined && row.price !== null
                ? Number(row.price)
                : null,
            imageUrl: row.image_url || null,
            itemType: row.item_type || null,
            rawItemType: row.raw_item_type || null,
            incomeAccount: row.income_account || null,
            available:
              row.available !== undefined && row.available !== null
                ? Number(row.available)
                : null,
          }))
          .filter(
            (item) => item.itemType !== null && item.incomeAccount !== null
          ) || [];

      console.log(
        `✅ Loaded ${
          products.length
        } products from Supabase ns_products (pages=${page + 1})`
      );
      return NextResponse.json(products);
    } catch (err) {
      console.error(
        "Error fetching products from Supabase, falling back to NetSuite:",
        err
      );
    }
  } else {
    console.warn(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; using NetSuite directly."
    );
  }

  try {
    const products = await netsuiteGetAllProductsQL(
      Number.isFinite(maxPages) ? maxPages : Infinity
    );
    return NextResponse.json(products);
  } catch (error: any) {
    console.error("Error fetching NetSuite products:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}
