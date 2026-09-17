import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { paymentDb } from "@/lib/payment-server";
import { checked } from "@/lib/operations-server";
import { readOperationalQlik } from "@/lib/qlik-operational";
import {
  CLIENT_STATUS_SPEC,
  mapQlikClientStatuses,
} from "@/lib/qlik-client-status";

export const runtime = "nodejs";
export const maxDuration = 300;
const slug = "qlik-client-status";
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (
    !secret ||
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  const db = paymentDb();
  let runId: string | undefined;
  try {
    const connection = await checked(
      db.from("data_connections").select("active").eq("slug", slug).single(),
    );
    if (!connection.active) return reply({ paused: true });
    await checked(
      db
        .from("data_connection_runs")
        .update({
          status: "error",
          error_message: "Execução anterior interrompida.",
          finished_at: new Date().toISOString(),
        })
        .eq("connection_slug", slug)
        .eq("status", "running")
        .lt("started_at", new Date(Date.now() - 10 * 60000).toISOString()),
    );
    const started = await db
      .from("data_connection_runs")
      .insert({
        connection_slug: slug,
        status: "running",
        trigger_source: request.headers
          .get("user-agent")
          ?.includes("vercel-cron")
          ? "cron"
          : "api",
      })
      .select("id")
      .single();
    if (started.error?.code === "23505")
      return reply({ error: "Atualização já em andamento." }, 409);
    if (started.error) throw started.error;
    runId = started.data.id;
    await checked(
      db
        .from("data_connections")
        .update({ last_run_at: new Date().toISOString() })
        .eq("slug", slug),
    );
    const { cubes } = await readOperationalQlik(
      [CLIENT_STATUS_SPEC],
      false,
      undefined,
      "sales",
    );
    const cube = cubes[0];
    if (!cube?.revision)
      throw new Error("Versão da fonte de contratos não identificada.");
    const rows = mapQlikClientStatuses(cube);
    await checked(
      db
        .from("data_connection_runs")
        .update({
          rows_read: rows.length,
          details: { source_revision: cube.revision },
        })
        .eq("id", runId),
    );
    const result = await checked(
      db.rpc("publish_client_property_statuses", {
        p_rows: rows,
        p_source_revision: cube.revision,
      }),
    );
    const now = new Date().toISOString();
    await checked(
      db
        .from("data_connection_runs")
        .update({
          status: "success",
          finished_at: now,
          rows_read: rows.length,
          rows_written: result.matched_contracts,
          details: { ...result, source_revision: cube.revision },
        })
        .eq("id", runId),
    );
    await checked(
      db
        .from("data_connections")
        .update({ last_success_at: now, last_error: null, last_error_at: null })
        .eq("slug", slug),
    );
    return reply({ ok: true, ...result, source_revision: cube.revision });
  } catch (error) {
    const message =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message.slice(0, 1500)
        : "Falha ao atualizar situação dos contratos.";
    if (runId) {
      await db
        .from("data_connection_runs")
        .update({
          status: "error",
          error_message: message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
      await db
        .from("data_connections")
        .update({
          last_error: message,
          last_error_at: new Date().toISOString(),
        })
        .eq("slug", slug);
    }
    return reply({ error: message }, 502);
  }
}
