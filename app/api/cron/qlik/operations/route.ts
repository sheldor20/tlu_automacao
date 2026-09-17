import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { readOperationalQlik } from "@/lib/qlik-operational";
import { syncQlikOperations } from "@/lib/qlik-operations-sync";
export const maxDuration = 800;
export async function GET(request: Request) {
  const provided = Buffer.from(request.headers.get("authorization") || "");
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret}`);
  if (
    !secret ||
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("inspect") === "1") {
      const specs = z
        .array(
          z.object({
            key: z.string().max(100),
            fields: z.array(z.string().max(200)).max(30).optional(),
            objectId: z.string().max(100).optional(),
            measureId: z.string().max(100).optional(),
            limit: z.number().int().min(1).max(1000).default(3),
          }),
        )
        .max(20)
        .parse(JSON.parse(url.searchParams.get("specs") || "[]"));
      return NextResponse.json(await readOperationalQlik(specs, true), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const kind = z
      .enum(["catalog", "receivable", "received", "payable", "paid"])
      .parse(url.searchParams.get("kind") || "catalog");
    return syncQlikOperations(kind);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha na leitura." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
