import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { NextResponse, after } from "next/server";
import { readOperationalQlik } from "@/lib/qlik-operational";
import {
  syncQlikOperations,
  nextOperationalImport,
} from "@/lib/qlik-operations-sync";
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
      const source = z
        .enum(["finance", "sales"])
        .parse(url.searchParams.get("source") || "finance");
      return NextResponse.json(
        await readOperationalQlik(specs, true, undefined, source),
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    const requested = z
      .enum([
        "catalog",
        "receivable",
        "received",
        "payable",
        "paid",
        "continue",
      ])
      .parse(url.searchParams.get("kind") || "catalog");
    const kind =
      requested === "continue" ? await nextOperationalImport() : requested;
    if (!kind) return NextResponse.json({ ok: true, idle: true });
    const response = await syncQlikOperations(kind);
    const result = await response.clone().json();
    if (
      (result.partial || result.retry) &&
      process.env.VERCEL_ENV === "production"
    ) {
      after(async () => {
        const continuation = await fetch(
          `https://www.terralotus.space/api/cron/qlik/operations?kind=${kind}`,
          { headers: { authorization: `Bearer ${secret}` }, cache: "no-store" },
        );
        if (!continuation.ok && continuation.status !== 409)
          console.error(
            "Continuação Qlik pendente; será retomada pelo cron.",
            kind,
            continuation.status,
          );
      });
    }
    return response;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha na leitura." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
