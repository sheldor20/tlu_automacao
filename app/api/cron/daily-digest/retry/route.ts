import { handleDailyDigestCron } from "@/lib/daily-digest-server";
export const runtime = "nodejs";
export const maxDuration = 240;
export async function GET(request: Request) {
  return handleDailyDigestCron(request, false);
}
