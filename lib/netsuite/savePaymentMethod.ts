import axios from "axios";
import { getValidToken } from "./token";

const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export async function savePaymentMethod(customerInternalId, token) {
  const accessToken = await getValidToken();

  const payload = {
    paymentmethod: token,

    paymentMethod: {
      refName: "General Token",
    },
  };
  console.log("Hey! pay", payload, customerInternalId);
  try {
    const response = await axios.patch(
      `${BASE_URL}/record/v1/customer/${customerInternalId}`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Hey", response);
    return response.data;
  } catch (error) {
    console.error("Error saving payment method to NetSuite:", error);
    throw error;
  }
}
