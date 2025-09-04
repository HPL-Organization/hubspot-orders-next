// src/app/api/netsuite/record-deposit/route.ts
import { NextResponse } from "next/server";
import { recordDepositForSalesOrder } from "../../../../../lib/netsuite/recordDeposit";

function normalizeDetails(raw: any): string[] {
  try {
    // Prefer NetSuite-style o:errorDetails if present
    if (Array.isArray(raw?.["o:errorDetails"])) {
      return raw["o:errorDetails"].map(
        (d: any) => d?.message || d?.detail || JSON.stringify(d)
      );
    }
    if (Array.isArray(raw?.details)) {
      return raw.details.map(
        (d: any) => d?.message || d?.detail || JSON.stringify(d)
      );
    }
    if (Array.isArray(raw)) {
      return raw.map((d: any) =>
        typeof d === "string" ? d : JSON.stringify(d)
      );
    }
    if (typeof raw === "string" && raw.trim()) return [raw];
    if (raw && typeof raw === "object") {
      const msg = raw.message || raw.detail || raw.title;
      if (msg) return [msg];
    }
  } catch {}
  return [];
}

export async function POST(req: Request) {
  try {
    const {
      salesOrderInternalId,
      amount,
      undepFunds = true,
      accountId,
      paymentMethodId,
      paymentOptionId,
      trandate,
      memo,
      externalId,
      exchangeRate,
      extraFields,
    } = await req.json();

    if (!salesOrderInternalId || typeof amount !== "number") {
      return NextResponse.json(
        { error: "Missing salesOrderInternalId or amount" },
        { status: 400 }
      );
    }

    const result = await recordDepositForSalesOrder(salesOrderInternalId, {
      amount,
      undepFunds,
      accountId,
      paymentMethodId,
      paymentOptionId,
      trandate,
      memo,
      externalId,
      exchangeRate,
      extraFields,
    });

    return NextResponse.json(
      {
        ok: true,
        mode: result.mode,
        depositInternalId: result.id,
        deposit: result.raw,
      },
      { status: 200 }
    );
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500;

    const raw = e?.details ?? e?.payload ?? e?.ns ?? e?.body ?? e;

    const errorCode =
      raw?.["o:errorCode"] ?? e?.errorCode ?? e?.code ?? undefined;

    const details = normalizeDetails(raw);

    const pretty =
      (typeof e?.message === "string" && e.message) ||
      (details.length ? details.join(" | ") : "Failed to record deposit");

    console.error("record-deposit error", {
      status,
      errorCode,
      pretty,
      details,
      soId: e?.soId ?? undefined,
    });

    return NextResponse.json(
      {
        error: "Failed to record deposit",
        pretty,
        errorCode,
        details,
        raw,
      },
      { status }
    );
  }
}
