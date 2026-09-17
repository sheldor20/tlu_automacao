import { NextResponse } from "next/server";
import { paymentDb } from "./payment-server";
import { readOperationalQlik } from "./qlik-operational";
import { retryImportWrite } from "./operational-import-retry";
import {
  catalogSpecs,
  operationalSpec,
  mapOperationalPage,
  type OperationalKind,
  type ImportRecord,
} from "./qlik-operational-mapping";
export async function syncQlikOperations(kind: OperationalKind) {
  const db = paymentDb();
  const configuration = await db
    .from("data_connections")
    .select("active")
    .eq("slug", "qlik-operations")
    .single();
  if (configuration.error) throw new Error("Conexão operacional indisponível.");
  if (!configuration.data.active) return NextResponse.json({ paused: true });
  const started = new Date().toISOString();
  const lock = await db.rpc("begin_operational_import", { p_kind: kind });
  if (lock.error)
    return NextResponse.json(
      {
        error:
          "Já existe uma carga desta origem ou a migração ainda não foi aplicada.",
      },
      { status: 409 },
    );
  const run = lock.data as string;
  const catalog = new Map<string, ImportRecord>();
  const seen = new Set<string>();
  // Read source pages concurrently, but serialize relational writes so pages
  // sharing the same customer or contract cannot wait on each other's inserts.
  let pageQueue: Promise<void> = Promise.resolve();
  let count = 0,
    total = 0,
    sourceTotal: number | null = null;
  try {
    await db
      .from("data_connections")
      .update({ last_run_at: started })
      .eq("slug", "qlik-operations");
    await readOperationalQlik(
      kind === "catalog" ? catalogSpecs : [operationalSpec(kind)],
      false,
      (cube) => {
        const next = pageQueue.then(async () => {
          const mapped = mapOperationalPage(cube, kind);
          const entries: ImportRecord[] = [];
          if (cube.key === kind) sourceTotal = cube.total ?? null;
          for (const record of mapped.records) {
            if (record.entity === "entries") {
              if (seen.has(record.id))
                throw new Error("Parcela repetida na extração.");
              seen.add(record.id);
              entries.push(record);
              count++;
            } else {
              const key = record.entity + ":" + record.id;
              const prior = catalog.get(key);
              if (
                prior &&
                JSON.stringify(prior.data) !== JSON.stringify(record.data)
              )
                throw new Error(
                  "Identificação ambígua na origem: " + record.entity,
                );
              catalog.set(key, record);
            }
          }
          total += mapped.total;
          if (entries.length) {
            const staged = await retryImportWrite(() =>
              db.rpc("stage_operational_entries", {
                p_run: run,
                p_rows: mapped.records,
              }),
            );
            if (staged.error)
              throw new Error(
                "Falha ao preparar página financeira: " + staged.error.message,
              );
          }
        });
        pageQueue = next;
        return next;
      },
    );
    if (
      kind !== "catalog" &&
      (sourceTotal === null ||
        Math.abs(total - sourceTotal) > Math.max(0.01, count * 0.000001))
    )
      throw new Error(
        "O detalhamento não confere com o total do indicador do Qlik.",
      );
    if (
      kind === "catalog" &&
      (!catalog.size ||
        ![...catalog.values()].some((c) => c.entity === "works"))
    )
      throw new Error("Catálogo vazio.");
    const records = [...catalog.values()];
    for (let offset = 0; offset < records.length; offset += 1000) {
      const saved = await retryImportWrite(() =>
        db.from("operational_import_rows").upsert(
          records
            .slice(offset, offset + 1000)
            .map((e) => ({ ...e, run_id: run })),
          { onConflict: "run_id,entity,id" },
        ),
      );
      if (saved.error)
        throw new Error("Falha ao preparar cadastros: " + saved.error.message);
    }
    const audit = await db
      .from("operational_imports")
      .update({ row_count: count, total: sourceTotal })
      .eq("id", run);
    if (audit.error) throw audit.error;
    const published = await db.rpc("publish_operational_import", {
      p_run: run,
      p_count: count,
      p_total: Math.round(total * 1e6) / 1e6,
    });
    if (published.error)
      throw new Error("Falha na publicação: " + published.error.message);
    return NextResponse.json({
      ok: true,
      kind,
      rows: count,
      catalog: records.length,
      total,
      source_total: sourceTotal,
      synchronized_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : "Falha na origem operacional"
    )
      .split("\n")[0]
      .slice(0, 1000);
    await Promise.all([
      retryImportWrite(() =>
        db
          .from("operational_imports")
          .update({
            status: "error",
            error: message,
            finished_at: new Date().toISOString(),
          })
          .eq("id", run)
          .eq("status", "running"),
      ),
      retryImportWrite(() =>
        db
          .from("data_connections")
          .update({
            last_error: message,
            last_error_at: new Date().toISOString(),
          })
          .eq("slug", "qlik-operations"),
      ),
    ]);
    return NextResponse.json(
      { error: message, preserved_previous: true },
      { status: 502 },
    );
  }
}
