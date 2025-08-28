import axios from "axios";
import { getValidToken } from "./token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const NETSUITE_BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

/**
 * Runs a SuiteQL query and returns all rows across pages.
 */
async function runSuiteQL(
  query: string,
  accessToken: string,
  maxPages: number = Infinity
): Promise<any[]> {
  let allItems: any[] = [];
  let url = `${NETSUITE_BASE_URL}/query/v1/suiteql`;
  let payload = { q: query };
  let pagesFetched = 0;

  while (url && pagesFetched < maxPages) {
    console.log("Running SuiteQL query at:", url);

    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
      timeout: 60000,
    });

    const items = resp.data.items ?? [];
    allItems.push(...items);
    pagesFetched++;

    const nextLink = resp.data.links?.find((l: any) => l.rel === "next");
    url = nextLink?.href || "";
  }

  return allItems;
}

/**
 * Main method to fetch products from NetSuite.
 */
export async function netsuiteGetAllProductsQL(
  maxPages = Infinity
): Promise<any[]> {
  const accessToken = await getValidToken();

  const suiteQL = `
    SELECT
      item.id,
      item.itemid,
      item.displayname,
      item.description,
      item.itemtype,
      pricing.unitprice AS baseprice,
      file.id AS fileid,
      file.name AS filename,
      file.url AS fileurl,
      aggloc.QuantityAvailable AS quantityavailable
    FROM
      item
    LEFT JOIN pricing
      ON pricing.item = item.id
      AND pricing.pricelevel = 1
    LEFT JOIN file
      ON item.custitem_atlas_item_image = file.id
    LEFT JOIN AggregateItemLocation aggloc
      ON aggloc.item = item.id
    WHERE
      item.isinactive = 'F'
    ORDER BY item.id
  `;

  console.log("🟡 Running SuiteQL Query...");
  const rows = await runSuiteQL(suiteQL, accessToken, maxPages);

  console.log(`🔍 Raw rows fetched: ${rows.length}`);
  if (rows.length > 0) {
    console.log("🧪 Sample row:\n", JSON.stringify(rows[0], null, 2));
  } else {
    console.warn("⚠️ No rows returned from SuiteQL.");
  }

  const products = rows
    .map((item) => {
      let fullImageUrl: null | string = null;
      if (item.fileurl) {
        fullImageUrl = `https://${NETSUITE_ACCOUNT_ID}.app.netsuite.com${item.fileurl}`;
      }

      const mappedType = mapNsTypeToReadable(item.itemtype);
      return {
        netsuiteType: "item",
        id: item.id,
        sku: item.itemid,
        name: item.displayname,
        description: item.description || null,
        price:
          item.baseprice !== undefined && item.baseprice !== null
            ? Number(item.baseprice)
            : null,
        imageUrl: fullImageUrl,
        itemType: mappedType,
        rawItemType: item.itemtype || null,
        available:
          item.quantityavailable !== undefined &&
          item.quantityavailable !== null
            ? Number(item.quantityavailable)
            : null,
      };
    })
    .filter((item) => item.itemType !== null);

  console.log(`✅ Loaded ${products.length} products via SuiteQL`);
  return products;
}

function mapNsTypeToReadable(type: string | null): string | null {
  if (!type) return null;
  switch (type) {
    case "InvtPart":
      return "inventory";
    case "NonInvtPart":
      return "non_inventory";
    case "Service":
      return "service";
    default:
      return null;
  }
}
