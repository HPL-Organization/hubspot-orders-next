import { NextRequest, NextResponse } from "next/server";
import { getValidToken } from "../../../../../lib/netsuite/token";
import { recordPaymentForInvoice } from "../../../../../lib/netsuite/recordPaymentForInvoice";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const RECORD_BASE = `https://${ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/record/v1`;

type PMDetail = {
  name: string;
  undepositedDefault: boolean | null;
  defaultAccountId: number | null;
  defaultAccountName: string | null;
};

async function getPaymentMethodDetail(
  paymentMethodId: number | string
): Promise<PMDetail> {
  const token = await getValidToken();
  const res = await fetch(`${RECORD_BASE}/paymentMethod/${paymentMethodId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  const txt = await res.text();
  let json: any = {};
  try {
    json = txt ? JSON.parse(txt) : {};
  } catch {}
  if (!res.ok) {
    return Promise.reject({
      status: res.status,
      message:
        json?.title ||
        json?.message ||
        `Failed to read Payment Method ${paymentMethodId}`,
      payload: json || txt,
    });
  }

  const undep = json?.undepFunds ?? json?.undepfunds ?? null;
  const accountObj = json?.account ?? null;
  const accountId = accountObj?.id ?? accountObj ?? null;
  const accountName = accountObj?.refName ?? accountObj?.name ?? null;

  return {
    name: String(json?.name ?? "Payment Method"),
    undepositedDefault: undep === null ? null : Boolean(undep),
    defaultAccountId: accountId != null ? Number(accountId) : null,
    defaultAccountName: accountName ?? null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Accept invoiceId or invoiceInternalId
    const invoiceId = body.invoiceId ?? body.invoiceInternalId;
    const amount = body.amount;
    const paymentMethodId = body.paymentMethodId;
    const paymentOptionId = body.paymentOptionId ?? undefined;
    const trandate = body.trandate ?? new Date().toISOString().slice(0, 10);
    const memo = body.memo ?? undefined;

    // New: postingMode = "requireDeposit" | "allowUndeposited"
    const postingMode: "requireDeposit" | "allowUndeposited" =
      body.postingMode === "allowUndeposited"
        ? "allowUndeposited"
        : "requireDeposit";

    if (!invoiceId || typeof amount !== "number" || !paymentMethodId) {
      return NextResponse.json(
        {
          success: false,
          message:
            "invoiceId (or invoiceInternalId), amount (number), and paymentMethodId are required",
        },
        { status: 400 }
      );
    }

    const pm = await getPaymentMethodDetail(paymentMethodId);

    // Enforce "do not use Undeposited" unless caller allows it
    if (pm.undepositedDefault === true) {
      if (postingMode === "requireDeposit") {
        return NextResponse.json(
          {
            success: false,
            reasonCode: "UNDEPOSITED_FORCED",
            message:
              "Payment Method is configured to 'Group with Undeposited Funds'.",
            paymentMethod: pm,
            attempt: {
              undepFunds: false,
              accountId: pm.defaultAccountId,
              invoiceId,
              amount,
              paymentMethodId,
              paymentOptionId,
            },
          },
          { status: 409 }
        );
      } else {
        // allowed fallback: post to Undeposited Funds
        const result = await recordPaymentForInvoice(Number(invoiceId), {
          amount: Number(amount),
          undepFunds: true,
          paymentMethodId: Number(paymentMethodId),
          paymentOptionId: paymentOptionId
            ? Number(paymentOptionId)
            : undefined,
          trandate,
          memo:
            memo ||
            `Recorded offline via app (${pm.name}) [undeposited fallback]`,
        });
        return NextResponse.json(
          {
            success: true,
            mode: result.mode,
            paymentId: result.id,
            payment: result.raw,
            used: {
              undepFunds: true,
              accountId: null,
              paymentMethodId: Number(paymentMethodId),
              paymentOptionId: paymentOptionId
                ? Number(paymentOptionId)
                : undefined,
              postingMode,
            },
          },
          { status: 200 }
        );
      }
    }

    // PM does not force Undeposited. We require a Deposit To account unless caller allows fallback.
    if (!pm.defaultAccountId) {
      if (postingMode === "requireDeposit") {
        return NextResponse.json(
          {
            success: false,
            reasonCode: "NO_DEPOSIT_TO_ACCOUNT",
            message:
              "Payment Method has no 'Deposit To' bank/cash account configured.",
            paymentMethod: pm,
            attempt: {
              undepFunds: false,
              accountId: null,
              invoiceId,
              amount,
              paymentMethodId,
              paymentOptionId,
            },
          },
          { status: 409 }
        );
      } else {
        const result = await recordPaymentForInvoice(Number(invoiceId), {
          amount: Number(amount),
          undepFunds: true,
          paymentMethodId: Number(paymentMethodId),
          paymentOptionId: paymentOptionId
            ? Number(paymentOptionId)
            : undefined,
          trandate,
          memo:
            memo ||
            `Recorded offline via app (${pm.name}) [undeposited fallback]`,
        });
        return NextResponse.json(
          {
            success: true,
            mode: result.mode,
            paymentId: result.id,
            payment: result.raw,
            used: {
              undepFunds: true,
              accountId: null,
              paymentMethodId: Number(paymentMethodId),
              paymentOptionId: paymentOptionId
                ? Number(paymentOptionId)
                : undefined,
              postingMode,
            },
          },
          { status: 200 }
        );
      }
    }

    const result = await recordPaymentForInvoice(Number(invoiceId), {
      amount: Number(amount),
      undepFunds: false,
      accountId: pm.defaultAccountId,
      paymentMethodId: Number(paymentMethodId),
      paymentOptionId: paymentOptionId ? Number(paymentOptionId) : undefined,
      trandate,
      memo: memo || `Recorded offline via app (${pm.name})`,
    });

    return NextResponse.json(
      {
        success: true,
        mode: result.mode,
        paymentId: result.id,
        payment: result.raw,
        used: {
          undepFunds: false,
          accountId: pm.defaultAccountId,
          paymentMethodId: Number(paymentMethodId),
          paymentOptionId: paymentOptionId
            ? Number(paymentOptionId)
            : undefined,
          postingMode,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    const status =
      typeof e?.status === "number"
        ? e.status
        : typeof e?.response?.status === "number"
        ? e.response.status
        : 500;

    return NextResponse.json(
      {
        success: false,
        reasonCode: "NETSUITE_ERROR",
        message: "Failed to record offline payment",
        details: e?.message || e?.toString?.() || "Unknown error",
        payload: e?.payload ?? e?.response?.data ?? null,
      },
      { status }
    );
  }
}
