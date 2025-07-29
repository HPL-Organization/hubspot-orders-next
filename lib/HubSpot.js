import axios from "axios";

const hubspot = axios.create({
  baseURL: "https://api.hubapi.com",
  headers: {
    Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
    "Content-Type": "application/json",
  },
});

export async function getContactByDealId(dealId) {
  const baseUrl = "https://api.hubapi.com";

  // Step 1: Get associated contact ID from deal
  const dealResponse = await fetch(
    `${baseUrl}/crm/v3/objects/deals/${dealId}/associations/contacts`,
    {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      },
    }
  );

  const dealData = await dealResponse.json();
  const contactId = dealData.results?.[0]?.id;

  if (!contactId) throw new Error("No contact associated with deal");

  // Step 2: Fetch contact details with full address properties
  const contactResponse = await fetch(
    `${baseUrl}/crm/v3/objects/contacts/${contactId}?properties=firstname,middle_name,lastname,phone,email,mobilephone,address,address_line_2,city,state,zip,country,shipping_address,shipping_address_line_2,shipping_city,shipping_state_region,shipping_postalcode,shipping_country_region`,
    {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      },
    }
  );

  const contactData = await contactResponse.json();
  // console.log(
  //   "💬 Contact data from HubSpot:",
  //   JSON.stringify(contactData, null, 2)
  // );

  return contactData;
}

export async function updateContactById(contactId, updateFields) {
  const res = await hubspot.patch(`/crm/v3/objects/contacts/${contactId}`, {
    properties: updateFields,
  });
  return res.data;
}

//put sales order number from netsuite to hubspot
export async function updateDealWithSalesOrder(dealId, tranid) {
  try {
    await hubspot.patch(`/crm/v3/objects/deals/${dealId}`, {
      properties: {
        netsuite_sale_id: tranid,
      },
    });
    console.log(
      ` Updated HubSpot deal ${dealId} with NetSuite tranid ${tranid}`
    );
  } catch (error) {
    console.error(
      " Failed to update HubSpot deal with tranid:",
      error.response?.data || error.message
    );
  }
}

//get sales order number from hubspot-
export async function getSalesOrderNumberFromDeal(dealId) {
  console.log("fetching sales order");
  try {
    const response = await hubspot.get(`/crm/v3/objects/deals/${dealId}`, {
      params: {
        properties: "netsuite_sale_id",
      },
    });

    const tranid = response.data.properties?.netsuite_sale_id;
    console.log(` Fetched tranid from HubSpot deal ${dealId}:`, tranid);
    return tranid || null;
  } catch (error) {
    console.error(" Failed to fetch tranid from deal:", error.message);
    return null;
  }
}
// Put internal NetSuite sales order ID into HubSpot
export async function updateDealWithSalesOrderInternalId(dealId, internalId) {
  try {
    await hubspot.patch(`/crm/v3/objects/deals/${dealId}`, {
      properties: {
        netsuite_so_int_id: internalId,
      },
    });
    console.log(
      `✅ Updated HubSpot deal ${dealId} with internal ID ${internalId}`
    );
  } catch (error) {
    console.error(
      " Failed to update HubSpot deal with internal ID:",
      error.response?.data || error.message
    );
  }
}

// Fetch internal NetSuite sales order ID from HubSpot
export async function getSalesOrderInternalIdFromDeal(dealId) {
  try {
    const response = await hubspot.get(`/crm/v3/objects/deals/${dealId}`, {
      params: {
        properties: "netsuite_so_int_id",
      },
    });

    const internalId = response.data.properties?.netsuite_so_int_id;
    console.log(
      `📦 Fetched internal ID from HubSpot deal ${dealId}:`,
      internalId
    );
    return internalId || null;
  } catch (error) {
    console.error(" Failed to fetch internal ID from deal:", error.message);
    return null;
  }
}
