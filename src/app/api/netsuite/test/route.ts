// src/app/api/netsuite/get-customers/route.ts
import { NextResponse } from "next/server";
import { getValidToken } from "../../../../../lib/netsuite/token";
import axios from "axios";

export async function GET() {
  try {
    const token = await getValidToken();

    const response = await axios.post(
      `https://${process.env.NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
      {
        q: "SELECT id, entityid, email FROM customer",
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "transient",
        },
      }
    );

    return NextResponse.json(response.data);
  } catch (error: any) {
    console.error("NetSuite Error:", error?.response?.data || error.message);
    return NextResponse.json(
      { error: "NetSuite request failed" },
      { status: 500 }
    );
  }
}
