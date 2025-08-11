import { NextRequest } from "next/server";
import axios from "axios";

const VP_API_BASE = process.env.VERSAPAY_BASE_URL + "/api/v2";

// export async function POST(req: NextRequest) {
//   try {
//     const gatewayAuthorization = {
//       apiKey: process.env.VERSAPAY_API_KEY!,
//       apiToken: process.env.VERSAPAY_API_TOKEN!,
//     };

//     const payload = {
//       gatewayAuthorization: {
//         apiKey: process.env.VERSAPAY_API_KEY!,
//         apiToken: process.env.VERSAPAY_API_TOKEN!,
//       },
//       options: {
//         wallet: {
//           allowAdd: true,
//           allowEdit: false,
//           allowDelete: false,
//           saveByDefault: true,
//         },
//         paymentTypes: [
//           {
//             name: "creditCard",
//             label: "Card",
//             promoted: true,
//             fields: [
//               //   {
//               //     name: "cardholderName",
//               //     label: "Cardholder Name",
//               //     errorLabel: "Cardholder name",
//               //   },
//               //   {
//               //     name: "accountNo",
//               //     label: "Card Number",
//               //     errorLabel: "Card number",
//               //   },
//               //   { name: "expDate", label: "Expiry", errorLabel: "Expiration" },
//               //   { name: "cvv", label: "CVV", errorLabel: "CVV" },
//             ],
//             paymentTypes: [
//               {
//                 name: "creditCard",
//                 label: "Payment Card",
//                 promoted: true,
//                 fields: [
//                   {
//                     name: "cardholderName",
//                     label: "Cardholder Name",
//                     errorLabel: "Cardholder name",
//                   },
//                   {
//                     name: "accountNo",
//                     label: "Account Number",
//                     errorLabel: "Credit card number",
//                   },
//                   {
//                     name: "expDate",
//                     label: "Expiration Date",
//                     errorLabel: "Expiration date",
//                   },
//                   {
//                     name: "cvv",
//                     label: "Security Code",
//                     errorLabel: "Security code",
//                   },
//                 ],
//               },
//               // If/when you want ACH later, add another entry here
//             ],
//           },
//         ],
//         avsRules: {
//           rejectAddressMismatch: false,
//           rejectPostCodeMismatch: false,
//           rejectUnknown: false,
//         },
//       },
//     };

//     const sessionResp = await axios.post(`${VP_API_BASE}/sessions`, payload, {
//       headers: {
//         "Content-Type": "application/json",
//         Accept: "application/json",
//       },
//     });

//     const sessionId = sessionResp.data.id;

//     return new Response(JSON.stringify({ sessionId }), { status: 200 });
//   } catch (err: any) {
//     console.error(
//       "Failed to create Versapay session:",
//       err.response?.data || err.message
//     );
//     return new Response(JSON.stringify({ error: "Session creation failed" }), {
//       status: 500,
//     });
//   }
// }

export async function POST(req: NextRequest) {
  try {
    const gatewayAuthorization = {
      apiKey: process.env.VERSAPAY_API_KEY!,
      apiToken: process.env.VERSAPAY_API_TOKEN!,
    };

    const payload = {
      gatewayAuthorization: {
        apiKey: process.env.VERSAPAY_API_KEY!,
        apiToken: process.env.VERSAPAY_API_TOKEN!,
      },
      options: {
        wallet: {
          allowAdd: false,
          allowEdit: false,
          allowDelete: false,
          saveByDefault: false,
        },
        paymentTypes: [
          {
            name: "creditCard",
            label: "Payment Card",
            promoted: true,
            fields: [
              {
                name: "cardholderName",
                label: "Cardholder Name",
                errorLabel: "Cardholder name",
              },
              {
                name: "accountNo",
                label: "Account Number",
                errorLabel: "Credit card number",
              },
              {
                name: "expDate",
                label: "Expiration Date",
                errorLabel: "Expiration date",
              },
              {
                name: "cvv",
                label: "Security Code",
                errorLabel: "Security code",
              },
            ],
          },
        ],
        avsRules: {
          rejectAddressMismatch: false,
          rejectPostCodeMismatch: false,
          rejectUnknown: false,
        },
      },
    };

    const sessionResp = await axios.post(`${VP_API_BASE}/sessions`, payload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const sessionId = sessionResp.data.id;

    return new Response(JSON.stringify({ sessionId }), { status: 200 });
  } catch (err: any) {
    console.error(
      "Failed to create Versapay session:",
      err.response?.data || err.message
    );
    return new Response(JSON.stringify({ error: "Session creation failed" }), {
      status: 500,
    });
  }
}
