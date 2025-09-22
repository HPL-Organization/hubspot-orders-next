import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { getValidToken } from "../../../../../lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const toNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const gt0 = (n: number) => Number.isFinite(n) && n > 1e-6;
const round2 = (n: number) => Number((Math.round(n * 100) / 100).toFixed(2));

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const customerId = Number(body?.customerId);
    const invoiceId = Number(body?.invoiceId);
    const depositId = Number(body?.depositId);
    const explicitAmount = body?.amount != null ? Number(body.amount) : null;
    const trandate =
      typeof body?.trandate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.trandate)
        ? body.trandate
        : new Date().toISOString().slice(0, 10);

    if (!customerId || !invoiceId || !depositId) {
      return NextResponse.json(
        { error: "Missing required fields: customerId, invoiceId, depositId" },
        { status: 400 }
      );
    }

    const token = await getValidToken();
    const auth = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    const inv = (
      await axios.get(
        `${BASE}/record/v1/invoice/${invoiceId}?fields=${encodeURIComponent(
          "id,tranId,tranDate,amountRemaining,entity,subsidiary,currency"
        )}`,
        { headers: auth }
      )
    ).data;

    if (!inv?.id)
      return NextResponse.json(
        { error: `Invoice ${invoiceId} not found` },
        { status: 404 }
      );
    const invCustomerId = Number(inv?.entity?.id ?? inv?.entity);
    if (invCustomerId !== customerId) {
      return NextResponse.json(
        { error: `Invoice ${invoiceId} belongs to customer ${invCustomerId}` },
        { status: 400 }
      );
    }
    const invoiceRemaining = toNum(inv?.amountRemaining);
    if (!gt0(invoiceRemaining)) {
      return NextResponse.json(
        { error: `Invoice ${invoiceId} has no remaining balance` },
        { status: 400 }
      );
    }

    const dep = (
      await axios.get(
        `${BASE}/record/v1/customerDeposit/${depositId}?fields=${encodeURIComponent(
          "id,tranId,unapplied,total,entity,customer,subsidiary,currency"
        )}`,
        { headers: auth }
      )
    ).data;

    if (!dep?.id)
      return NextResponse.json(
        { error: `Customer Deposit ${depositId} not found` },
        { status: 404 }
      );
    const depCustomerId = Number(
      dep?.customer?.id ?? dep?.customer ?? dep?.entity?.id ?? dep?.entity
    );
    if (depCustomerId !== customerId) {
      return NextResponse.json(
        { error: `Deposit ${depositId} belongs to customer ${depCustomerId}` },
        { status: 400 }
      );
    }

    const invSubs = inv?.subsidiary?.id ?? inv?.subsidiary ?? null;
    const depSubs = dep?.subsidiary?.id ?? dep?.subsidiary ?? null;
    if (String(invSubs) !== String(depSubs)) {
      return NextResponse.json(
        { error: `Subsidiary mismatch. Invoice=${invSubs} Deposit=${depSubs}` },
        { status: 400 }
      );
    }
    const invCurr = inv?.currency?.id ?? inv?.currency;
    const depCurr = dep?.currency?.id ?? dep?.currency;
    if (String(invCurr) !== String(depCurr)) {
      return NextResponse.json(
        { error: `Currency mismatch. Invoice=${invCurr} Deposit=${depCurr}` },
        { status: 400 }
      );
    }

    const depositUnapplied = toNum(dep?.unapplied);
    const usableDeposit = Number.isFinite(depositUnapplied)
      ? depositUnapplied
      : NaN;

    let amountToApply =
      explicitAmount != null
        ? explicitAmount
        : Math.min(usableDeposit, invoiceRemaining);
    amountToApply = round2(amountToApply);

    if (!gt0(amountToApply)) {
      return NextResponse.json(
        { error: `Deposit ${depositId} has no remaining amount` },
        { status: 400 }
      );
    }

    const payload: any = {
      trandate,
      ...(invSubs ? { subsidiary: { id: Number(invSubs) } } : {}),
      apply: {
        items: [
          {
            apply: true,
            amount: amountToApply,
            doc: { id: Number(invoiceId) },
          },
        ],
      },
      memo: `Apply deposit ${dep?.tranId || depositId} to invoice ${
        inv?.tranId || invoiceId
      }`,
    };

    const resp = await axios.post(
      `${BASE}/record/v1/customerDeposit/${depositId}/!transform/depositApplication`,
      payload,
      {
        headers: {
          ...auth,
          "Content-Type": "application/json",
          Prefer: "transient",
        },
      }
    );

    const createdId = resp.data?.id ?? resp.data?.internalId ?? null;

    return NextResponse.json({
      message: "Deposit applied via Deposit Application (transform)",
      depositApplicationId: createdId,
      applied: {
        invoiceId,
        depositId,
        amount: amountToApply,
        currency: invCurr,
        subsidiary: invSubs ?? null,
      },
    });
  } catch (err: any) {
    const details =
      err?.response?.data ||
      err?.message ||
      (typeof err === "string" ? err : "Unknown error");
    return NextResponse.json(
      { error: "Failed to apply deposit", details },
      { status: 500 }
    );
  }
}
