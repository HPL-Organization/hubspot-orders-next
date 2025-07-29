// src/app/api/netsuite/products/route.ts
import { NextRequest, NextResponse } from "next/server";
import { netsuiteGetAllProductsQL } from "../../../../../lib/netsuite/netsuiteGetAllProductsQL";

// export async function GET() {
//   try {
//     const products = await netsuiteGetAllProductsQL();
//     return NextResponse.json(products);
//   } catch (error: any) {
//     console.error("Error fetching NetSuite products:", error.message);
//     return NextResponse.json(
//       { error: "Failed to fetch products" },
//       { status: 500 }
//     );
//   }
// }
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url!);
  const maxPages = Number(searchParams.get("maxPages") || "Infinity");

  try {
    const products = await netsuiteGetAllProductsQL(maxPages);
    return NextResponse.json(products);
  } catch (error: any) {
    console.error("Error fetching NetSuite products:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}
