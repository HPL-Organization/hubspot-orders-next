import axios from "axios";
import { getValidToken } from "../token";

const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
export const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export async function nsClient() {
  const token: any = await getValidToken();
  const accessToken =
    token?.access_token || token?.accessToken || token?.token || token;

  return axios.create({
    baseURL: BASE_URL,
    timeout: 20000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
}
