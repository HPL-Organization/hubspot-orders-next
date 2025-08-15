import { runSuiteQL } from "./suiteql";

export type NsOrderLine = {
  sku: string;
  description: string;
  price: number;
  quantity: number;
};

export async function getSalesOrderLines(soId: number): Promise<NsOrderLine[]> {
  const id = Number(soId);

  const rows = await runSuiteQL(`
    SELECT
      i.itemid AS sku,
      NVL(tl.description, i.displayname) AS description,
      tl.rate AS price,
      tl.quantity AS quantity
    FROM transactionline tl
    JOIN item i ON i.id = tl.item
    WHERE tl.transaction = ${id}
      AND tl.mainline = 'F'
      AND NVL(tl.taxline, 'F') = 'F'
      AND NVL(tl.shipping, 'F') = 'F'
      AND NVL(tl.cogs, 'F') = 'F'
  `);

  return rows.map((r: any) => ({
    sku: String(r.sku),
    description: r.description || String(r.sku),
    price: Number(r.price ?? 0),
    quantity: Number(r.quantity ?? 0),
  }));
}
