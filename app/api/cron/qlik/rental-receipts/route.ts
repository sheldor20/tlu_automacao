import { NextResponse } from "next/server";
import { syncRentalQlikReceipts } from "@/lib/rental-qlik-receipts-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return syncRentalQlikReceipts();
}
