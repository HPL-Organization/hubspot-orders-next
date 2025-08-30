// lib/netsuite/createNetsuiteCustomer.ts
import { getValidToken } from "./token";
import axios from "axios";
const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const COUNTRY_CODES: Record<string, string> = {
  Aruba: "AW",
  Afghanistan: "AF",
  Angola: "AO",
  Anguilla: "AI",
  "Åland Islands": "AX",
  Albania: "AL",
  Andorra: "AD",
  "United Arab Emirates": "AE",
  Argentina: "AR",
  Armenia: "AM",
  "American Samoa": "AS",
  Antarctica: "AQ",
  "French Southern Territories": "TF",
  "Antigua and Barbuda": "AG",
  Australia: "AU",
  Austria: "AT",
  Azerbaijan: "AZ",
  Burundi: "BI",
  Belgium: "BE",
  Benin: "BJ",
  "Bonaire, Sint Eustatius and Saba": "BQ",
  "Burkina Faso": "BF",
  Bangladesh: "BD",
  Bulgaria: "BG",
  Bahrain: "BH",
  Bahamas: "BS",
  "Bosnia and Herzegovina": "BA",
  "Saint Barthélemy": "BL",
  Belarus: "BY",
  Belize: "BZ",
  Bermuda: "BM",
  "Bolivia, Plurinational State of": "BO",
  Brazil: "BR",
  Barbados: "BB",
  "Brunei Darussalam": "BN",
  Bhutan: "BT",
  "Bouvet Island": "BV",
  Botswana: "BW",
  "Central African Republic": "CF",
  Canada: "CA",
  "Cocos (Keeling) Islands": "CC",
  Switzerland: "CH",
  Chile: "CL",
  China: "CN",
  "Côte d'Ivoire": "CI",
  Cameroon: "CM",
  "Congo, The Democratic Republic of the": "CD",
  Congo: "CG",
  "Cook Islands": "CK",
  Colombia: "CO",
  Comoros: "KM",
  "Cabo Verde": "CV",
  "Costa Rica": "CR",
  Cuba: "CU",
  Curaçao: "CW",
  "Christmas Island": "CX",
  "Cayman Islands": "KY",
  Cyprus: "CY",
  Czechia: "CZ",
  Germany: "DE",
  Djibouti: "DJ",
  Dominica: "DM",
  Denmark: "DK",
  "Dominican Republic": "DO",
  Algeria: "DZ",
  Ecuador: "EC",
  Egypt: "EG",
  Eritrea: "ER",
  "Western Sahara": "EH",
  Spain: "ES",
  Estonia: "EE",
  Ethiopia: "ET",
  Finland: "FI",
  Fiji: "FJ",
  "Falkland Islands (Malvinas)": "FK",
  France: "FR",
  "Faroe Islands": "FO",
  "Micronesia, Federated States of": "FM",
  Gabon: "GA",
  "United Kingdom": "GB",
  Georgia: "GE",
  Guernsey: "GG",
  Ghana: "GH",
  Gibraltar: "GI",
  Guinea: "GN",
  Guadeloupe: "GP",
  Gambia: "GM",
  "Guinea-Bissau": "GW",
  "Equatorial Guinea": "GQ",
  Greece: "GR",
  Grenada: "GD",
  Greenland: "GL",
  Guatemala: "GT",
  "French Guiana": "GF",
  Guam: "GU",
  Guyana: "GY",
  "Hong Kong": "HK",
  "Heard Island and McDonald Islands": "HM",
  Honduras: "HN",
  Croatia: "HR",
  Haiti: "HT",
  Hungary: "HU",
  Indonesia: "ID",
  "Isle of Man": "IM",
  India: "IN",
  "British Indian Ocean Territory": "IO",
  Ireland: "IE",
  "Iran, Islamic Republic of": "IR",
  Iraq: "IQ",
  Iceland: "IS",
  Israel: "IL",
  Italy: "IT",
  Jamaica: "JM",
  Jersey: "JE",
  Jordan: "JO",
  Japan: "JP",
  Kazakhstan: "KZ",
  Kenya: "KE",
  Kyrgyzstan: "KG",
  Cambodia: "KH",
  Kiribati: "KI",
  "Saint Kitts and Nevis": "KN",
  "Korea, Republic of": "KR",
  Kuwait: "KW",
  "Lao People's Democratic Republic": "LA",
  Lebanon: "LB",
  Liberia: "LR",
  Libya: "LY",
  "Saint Lucia": "LC",
  Liechtenstein: "LI",
  "Sri Lanka": "LK",
  Lesotho: "LS",
  Lithuania: "LT",
  Luxembourg: "LU",
  Latvia: "LV",
  Macao: "MO",
  "Saint Martin (French part)": "MF",
  Morocco: "MA",
  Monaco: "MC",
  "Moldova, Republic of": "MD",
  Madagascar: "MG",
  Maldives: "MV",
  Mexico: "MX",
  "Marshall Islands": "MH",
  "North Macedonia": "MK",
  Mali: "ML",
  Malta: "MT",
  Myanmar: "MM",
  Montenegro: "ME",
  Mongolia: "MN",
  "Northern Mariana Islands": "MP",
  Mozambique: "MZ",
  Mauritania: "MR",
  Montserrat: "MS",
  Martinique: "MQ",
  Mauritius: "MU",
  Malawi: "MW",
  Malaysia: "MY",
  Mayotte: "YT",
  Namibia: "NA",
  "New Caledonia": "NC",
  Niger: "NE",
  "Norfolk Island": "NF",
  Nigeria: "NG",
  Nicaragua: "NI",
  Niue: "NU",
  Netherlands: "NL",
  Norway: "NO",
  Nepal: "NP",
  Nauru: "NR",
  "New Zealand": "NZ",
  Oman: "OM",
  Pakistan: "PK",
  Panama: "PA",
  Pitcairn: "PN",
  Peru: "PE",
  Philippines: "PH",
  Palau: "PW",
  "Papua New Guinea": "PG",
  Poland: "PL",
  "Puerto Rico": "PR",
  "Korea, Democratic People's Republic of": "KP",
  Portugal: "PT",
  Paraguay: "PY",
  "Palestine, State of": "PS",
  "French Polynesia": "PF",
  Qatar: "QA",
  Réunion: "RE",
  Romania: "RO",
  "Russian Federation": "RU",
  Rwanda: "RW",
  "Saudi Arabia": "SA",
  Sudan: "SD",
  Senegal: "SN",
  Singapore: "SG",
  "South Georgia and the South Sandwich Islands": "GS",
  "Saint Helena, Ascension and Tristan da Cunha": "SH",
  "Svalbard and Jan Mayen": "SJ",
  "Solomon Islands": "SB",
  "Sierra Leone": "SL",
  "El Salvador": "SV",
  "San Marino": "SM",
  Somalia: "SO",
  "Saint Pierre and Miquelon": "PM",
  Serbia: "RS",
  "South Sudan": "SS",
  "Sao Tome and Principe": "ST",
  Suriname: "SR",
  Slovakia: "SK",
  Slovenia: "SI",
  Sweden: "SE",
  Eswatini: "SZ",
  "Sint Maarten (Dutch part)": "SX",
  Seychelles: "SC",
  "Syrian Arab Republic": "SY",
  "Turks and Caicos Islands": "TC",
  Chad: "TD",
  Togo: "TG",
  Thailand: "TH",
  Tajikistan: "TJ",
  Tokelau: "TK",
  Turkmenistan: "TM",
  "Timor-Leste": "TL",
  Tonga: "TO",
  "Trinidad and Tobago": "TT",
  Tunisia: "TN",
  Turkey: "TR",
  Tuvalu: "TV",
  "Taiwan, Province of China": "TW",
  "Tanzania, United Republic of": "TZ",
  Uganda: "UG",
  Ukraine: "UA",
  "United States Minor Outlying Islands": "UM",
  Uruguay: "UY",
  "United States": "US",
  USA: "US",
  Uzbekistan: "UZ",
  "Holy See (Vatican City State)": "VA",
  "Saint Vincent and the Grenadines": "VC",
  "Venezuela, Bolivarian Republic of": "VE",
  "Virgin Islands, British": "VG",
  "Virgin Islands, U.S.": "VI",
  "Viet Nam": "VN",
  Vanuatu: "VU",
  "Wallis and Futuna": "WF",
  Samoa: "WS",
  Yemen: "YE",
  "South Africa": "ZA",
  Zambia: "ZM",
  Zimbabwe: "ZW",
};

function getCountryCode(name: string): string {
  return COUNTRY_CODES[name] || name; // fallback to input if already a code
}

export async function createNetsuiteCustomer(customer: any) {
  const accessToken = await getValidToken();

  const existingId = await findCustomerByHubspotId(customer.id, accessToken);
  let billingId: string | null = null;
  let shippingId: string | null = null;
  let billingAddressId: string | null = null;
  let shippingAddressId: string | null = null;

  if (existingId) {
    const customerData = await getCustomerWithAddressbook(
      existingId,
      accessToken
    );

    console.log(
      "Fetched customerData.addressbook.items:",
      customerData?.addressbook
    );

    for (const addr of customerData?.addressbook?.items || []) {
      console.log("Checking address entry:", addr);

      if (addr.defaultBilling) {
        billingId = addr.internalId;
        billingAddressId = addr.addressbookaddress?.internalId;
        console.log("Found default billing address:", {
          billingId,
          billingAddressId,
        });
      }

      if (addr.defaultShipping) {
        shippingId = addr.internalId;
        shippingAddressId = addr.addressbookaddress?.internalId;
        console.log("Found default shipping address:", {
          shippingId,
          shippingAddressId,
        });
      }
    }
  }

  const payload = {
    entityId: customer.email,
    subsidiary: { id: "2" },
    companyName: `${customer.firstName} ${customer.lastName}`,
    email: customer.email,
    phone: customer.phone,
    mobilephone: customer.mobile,
    firstName: customer.firstName,
    middleName: customer.middleName,
    lastName: customer.lastName,
    custentityhs_id: customer.id,
    addressbook: {
      replaceAll: true,
      items: [
        {
          internalId: billingId || undefined,
          defaultBilling: true,
          defaultShipping: false,
          label: "Billing",
          addressbookaddress: {
            internalId: billingAddressId || undefined,
            addr1: customer.billingAddress1,
            addr2: customer.billingAddress2,
            city: customer.billingCity,
            state: customer.billingState,
            zip: customer.billingZip,
            country: getCountryCode(customer.billingCountry),
            addressee: `${customer.firstName} ${customer.lastName}`,
            defaultBilling: true,
            defaultShipping: false,
          },
        },
        {
          internalId: shippingId || undefined,
          defaultBilling: false,
          defaultShipping: true,
          label: "Shipping",
          addressbookaddress: {
            internalId: shippingAddressId || undefined,
            addr1: customer.shippingAddress1,
            addr2: customer.shippingAddress2,
            city: customer.shippingCity,
            state: customer.shippingState,
            zip: customer.shippingZip,
            country: getCountryCode(customer.shippingCountry),
            addressee: `${customer.firstName} ${customer.lastName}`,
            defaultBilling: false,
            defaultShipping: true,
          },
        },
      ],
    },
    shippingcarrier: (customer.shippingcarrier || "").toLowerCase(),
  };

  if (existingId) {
    console.log(`Updating existing customer ${existingId}`);
    const response = await axios.patch(
      `${BASE_URL}/record/v1/customer/${existingId}`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } else {
    console.log(`Creating new customer`);
    const response = await axios.post(
      `${BASE_URL}/record/v1/customer`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  }
}

//Finding customer through HUBSPOT ID

async function findCustomerByHubspotId(hsId: string, accessToken: string) {
  const suiteQL = `
  SELECT id FROM customer
  WHERE custentityhs_id = '${hsId}'
`;

  const resp = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    { q: suiteQL },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
    }
  );

  const match = resp.data.items?.[0];
  return match?.id || null;
}

//Get Addressbook id (to avoid duplicate addresses in addressbook)
async function getCustomerWithAddressbook(id: string, accessToken: string) {
  const listResp = await axios.get(
    `${BASE_URL}/record/v1/customer/${id}/addressBook`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }
  );

  const addressLinks = listResp.data.items.map(
    (item: any) => item.links.find((link: any) => link.rel === "self")?.href
  );

  const addressItems = await Promise.all(
    addressLinks.map((url: string) =>
      axios
        .get(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        })
        .then((res) => res.data)
    )
  );

  return { addressbook: { items: addressItems } };
}
