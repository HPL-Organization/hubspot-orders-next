import { createNetsuiteSalesOrder } from "../../../../../lib/netsuite/createNetsuiteSalesOrder";

interface IncomingLineItem {
  itemId: string;
  quantity: number;
  unitPrice: number;
  unitDiscount: number;
  isClosed: boolean;
  allowZeroRate?: boolean;
  [key: string]: any;
}

const ZERO_RATE_EPSILON = 1e-6;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log(" Incoming body:", body);

    const {
      hubspotSoId,
      hubspotContactId,
      lineItems,
      shipComplete,
      salesTeam,
      salesChannel,
      affiliateId,
      salesOrderDate,
      dealName,
      orderNotes,
      billingTermsId,
      soReference,
    } = body;

    if (!hubspotSoId || !hubspotContactId || !Array.isArray(lineItems)) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 }
      );
    }

    const typedLineItems: IncomingLineItem[] = lineItems;

    const zeroRateLines = typedLineItems
      .map((li, index) => ({ ...li, index }))
      .filter((li) => {
        if (li.isClosed) return false;
        if (!li.quantity || li.quantity <= 0) return false;
        if (li.allowZeroRate) return false;

        const unitPrice = Number(li.unitPrice) || 0;
        const unitDiscount = Number(li.unitDiscount) || 0;
        const effectiveRate = unitPrice * (1 - unitDiscount / 100);

        return Math.abs(effectiveRate) < ZERO_RATE_EPSILON;
      });

    if (zeroRateLines.length > 0) {
      console.warn(
        "Blocking SO creation: zero-rate lines detected",
        JSON.stringify(zeroRateLines, null, 2)
      );

      return new Response(
        JSON.stringify({
          status: "needs_confirmation",
          message:
            "One or more line items have quantity > 0 and a zero rate. Please confirm which ones to keep or remove.",
          zeroRateLines: zeroRateLines.map((li) => ({
            index: li.index,
            itemId: li.itemId,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            unitDiscount: li.unitDiscount,
          })),
        }),
        { status: 409 }
      );
    }

    const result = await createNetsuiteSalesOrder(
      hubspotSoId,
      hubspotContactId,
      typedLineItems,
      shipComplete,
      salesTeam,
      salesChannel,
      affiliateId,
      salesOrderDate ?? null,
      dealName,
      orderNotes,
      billingTermsId,
      soReference
    );
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err: any) {
    console.error(" Route error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
}
