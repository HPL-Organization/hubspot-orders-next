import { NextRequest } from "next/server";
import axios from "axios";

// Endpoint URL
const VP_API_BASE = process.env.VERSAPAY_BASE_URL + "/api/v2";

export async function createWallet(req: NextRequest) {
  try {
    const gatewayAuthorization = {
      apiKey: process.env.VERSAPAY_API_KEY!,
      apiToken: process.env.VERSAPAY_API_TOKEN!,
    };

    const walletPayload = {
      gatewayAuthorization: {
        apiKey: process.env.VERSAPAY_API_KEY!,
        apiToken: process.env.VERSAPAY_API_TOKEN!,
      },
    };

    const walletResp = await axios.post(
      `${VP_API_BASE}/wallets`,
      walletPayload,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    const walletId = walletResp.data.walletId;

    return new Response(JSON.stringify({ walletId }), { status: 200 });
  } catch (err: any) {
    console.error("Failed to create wallet:", err.response?.data || err);
    return new Response(JSON.stringify({ error: "Wallet creation failed" }), {
      status: 500,
    });
  }
}
