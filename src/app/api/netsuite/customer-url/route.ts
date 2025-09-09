// app/api/netsuite/customer-url/route.ts
import { NextResponse } from "next/server";

function pickAccountId() {
  const mode = (
    process.env.NETSUITE_ENV ||
    process.env.APP_ENV ||
    (process.env.NODE_ENV === "production" ? "prod" : "sb")
  ).toLowerCase();

  if (mode === "sb") {
    return (
      process.env.NETSUITE_ACCOUNT_ID_SB ||
      process.env.NETSUITE_ACCOUNT_ID ||
      null
    );
  }
  return (
    process.env.NETSUITE_ACCOUNT_ID ||
    process.env.NETSUITE_ACCOUNT_ID_SB ||
    null
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const name = searchParams.get("name");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const account = pickAccountId();
  if (!account) {
    return NextResponse.json(
      { error: "Account ID not configured" },
      { status: 500 }
    );
  }

  const url = `https://${account}.app.netsuite.com/app/common/entity/custjob.nl?id=${encodeURIComponent(
    id
  )}&whence=`;

  return NextResponse.json(name ? { url, name } : { url });
}
