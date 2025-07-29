/**
 * token.ts
 *
 * Automatically handles NetSuite OAuth2 Client Credentials flow,
 * including signing a JWT with PS256, and caching the token.
 */

import axios from "axios";
import { SignJWT, importPKCS8 } from "jose";
//import "dotenv/config";

// Load env vars from process.env
const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const CONSUMER_KEY = process.env.NETSUITE_CONSUMER_KEY!;
const PRIVATE_KEY_PEM = process.env.NETSUITE_PRIVATE_KEY!.replace(/\\n/g, "\n");
console.log("PRIVATE KEY STARTS WITH:", PRIVATE_KEY_PEM.slice(0, 30));

const CERTIFICATE_ID = process.env.NETSUITE_CERTIFICATE_ID; // optional

const TOKEN_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;

//  store the token and expiry time here
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Returns a valid NetSuite access token.
 * Automatically refreshes if expired.
 */
export async function getValidToken(): Promise<string> {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    // 30 second safety buffer
    return cachedToken.value;
  }

  console.log("Requesting new NetSuite access token...");

  const token = await requestAccessToken();

  // Cache token for ~55 minutes
  cachedToken = {
    value: token,
    expiresAt: now + 55 * 60 * 1000,
  };
  console.log(token);
  return token;
}

/**
 * Requests a new NetSuite access token via JWT bearer.
 */
async function requestAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Construct JWT payload
  const payload = {
    iss: CONSUMER_KEY,
    scope: ["restlets", "rest_webservices"],
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  // Import the private key (must be PKCS8 PEM string)
  const privateKey = await importPKCS8(PRIVATE_KEY_PEM, "PS256");

  // Build JWT header
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({
      alg: "PS256",
      typ: "JWT",
      ...(CERTIFICATE_ID && { kid: CERTIFICATE_ID }),
    })
    .sign(privateKey);

  // Send token request
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: jwt,
  });

  const res = await axios.post(TOKEN_URL, params.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!res.data.access_token) {
    console.error(res.data);
    throw new Error("Failed to retrieve NetSuite access token.");
  }

  return res.data.access_token;
}
