import { NextResponse } from "next/server";
import { paymentDb } from "./payment-server";
import { readOperationalQlik, type QlikCube } from "./qlik-operational";
import { retryImportWrite } from "./operational-import-retry";
import { localToday } from "./operational-finance";
import {
  catalogSpecs,
  operationalSpec,
  operationalPeopleSpec,
  mapOperationalPeople,
  mapOperationalPage,
  type OperationalKind,
  type ImportRecord,
} from "./qlik-operational-mapping";

const ROW_BUDGET = 100000;
async function checked<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T>;
}
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function nextOperationalImport(): Promise<OperationalKind | null> {
  const db = paymentDb();
  const rows = await checked(
    db
      .from("operational_imports")
      .select("kind,continuation_ready,lease_started_at,started_at,attempts")
      .eq("status", "running")
      .order("started_at")
      .limit(20),
  );
  const available = rows.find(
    (r) =>
      r.attempts < 12 &&
      (r.continuation_ready ||
        Date.parse(r.lease_started_at || r.started_at) <
          Date.now() - 15 * 60000),
  );
  return (available?.kind as OperationalKind) || null;
}

export async function syncQlikOperations(kind: OperationalKind) {
  const db = paymentDb();
  const configuration = await checked(
    db
      .from("data_connections")
      .select("active")
      .eq("slug", "qlik-operations")
      .single(),
  );
  if (!configuration.active) return reply({ paused: true });
  const lock = await db.rpc("begin_operational_import", { p_kind: kind });
  if (lock.error)
    return reply(
      { error: "Já existe uma etapa desta origem em execução." },
      409,
    );
  const run = lock.data as string;
  const info = await checked(
    db.from("operational_imports").select("*").eq("id", run).single(),
  );
  const progress = async () => {
    const r = await checked(
      db.rpc("operational_import_progress", { p_run: run }),
    );
    return { rows: Number(r[0].rows), total: Number(r[0].total) };
  };
  let initial = { rows: 0, total: 0 };
  let count = 0,
    total = 0,
    sourceRows: number | null = info.source_rows,
    sourceTotal: number | null =
      info.source_total === null ? null : Number(info.source_total),
    sourceRevision: string | null = info.source_revision;
  const catalog = new Map<string, ImportRecord>(),
    seen = new Set<string>();
  async function verifySource(cube: QlikCube) {
    if (!cube.revision) throw new Error("Versão da origem Qlik indisponível.");
    const revision = `v1|${cube.revision}|${localToday()}`;
    if (sourceRevision && sourceRevision !== revision)
      throw new Error("qlik_source_changed");
    if (
      !sourceRevision &&
      initial.rows &&
      Date.parse(cube.revision) > Date.parse(info.started_at)
    )
      throw new Error("qlik_source_changed");
    const patch: Record<string, unknown> = {};
    if (!sourceRevision) {
      sourceRevision = revision;
      patch.source_revision = revision;
    }
    if (cube.key === kind) {
      if (sourceRows !== null && sourceRows !== cube.totalRows)
        throw new Error("qlik_source_changed");
      if (
        cube.total == null ||
        (sourceTotal !== null && Math.abs(sourceTotal - cube.total) > 0.01)
      )
        throw new Error("qlik_source_changed");
      if (sourceRows === null) {
        sourceRows = cube.totalRows;
        patch.source_rows = sourceRows;
      }
      if (sourceTotal === null) {
        sourceTotal = cube.total;
        patch.source_total = sourceTotal;
      }
    }
    if (Object.keys(patch).length)
      await checked(
        retryImportWrite(() =>
          db.from("operational_imports").update(patch).eq("id", run),
        ),
      );
  }
  const addCatalog = (record: ImportRecord) => {
    const key = record.entity + ":" + record.id,
      prior = catalog.get(key);
    if (prior && JSON.stringify(prior.data) !== JSON.stringify(record.data))
      throw new Error("Identificação ambígua na origem: " + record.entity);
    catalog.set(key, record);
  };
  try {
    initial =
      info.row_count !== null && info.row_count === info.source_rows
        ? { rows: Number(info.row_count), total: Number(info.total) }
        : await progress();
    count = initial.rows;
    total = initial.total;
    await checked(
      db
        .from("data_connections")
        .update({ last_run_at: new Date().toISOString() })
        .eq("slug", "qlik-operations"),
    );
    const prepared =
      kind !== "catalog" &&
      info.row_count !== null &&
      Number(info.row_count) === count &&
      sourceRows === count;
    if (!prepared) {
      const specs =
        kind === "catalog"
          ? catalogSpecs
          : [
              ...(kind === "received" || kind === "receivable"
                ? [operationalPeopleSpec(kind)]
                : []),
              {
                ...operationalSpec(kind),
                offset: initial.rows,
                rowBudget: ROW_BUDGET,
              },
            ];
      const result = await readOperationalQlik(specs, false, async (cube) => {
        if (kind !== "catalog") await verifySource(cube);
        if (cube.key === "people") {
          for (const record of mapOperationalPeople(cube)) addCatalog(record);
          return;
        }
        const mapped = mapOperationalPage(cube, kind),
          entries: ImportRecord[] = [],
          pageCatalog = new Map<string, ImportRecord>();
        for (const record of mapped.records) {
          if (record.entity === "entries") {
            if (seen.has(record.id))
              throw new Error("Parcela repetida na extração.");
            seen.add(record.id);
            entries.push(record);
            count++;
          } else {
            addCatalog(record);
            pageCatalog.set(record.entity + ":" + record.id, record);
          }
        }
        total += mapped.total;
        if (entries.length) {
          const records = [...pageCatalog.values(), ...entries];
          for (let offset = 0; offset < records.length; offset += 5000)
            await checked(
              retryImportWrite(() =>
                db.rpc("stage_operational_entries", {
                  p_run: run,
                  p_rows: records.slice(offset, offset + 5000),
                }),
              ),
            );
        }
      });
      if (kind !== "catalog") {
        const financial = result.cubes.find((c) => c.key === kind);
        if (!financial) throw new Error("Origem financeira ausente.");
        await verifySource(financial);
      } else if (
        !catalog.size ||
        ![...catalog.values()].some((c) => c.entity === "works")
      )
        throw new Error("Catálogo vazio.");
      const records = [...catalog.values()];
      for (let offset = 0; offset < records.length; offset += 1000)
        await checked(
          retryImportWrite(() =>
            db.from("operational_import_rows").upsert(
              records
                .slice(offset, offset + 1000)
                .map((e) => ({ ...e, run_id: run })),
              { onConflict: "run_id,entity,id" },
            ),
          ),
        );
      const audited = await progress();
      if (audited.rows !== count || Math.abs(audited.total - total) > 0.01)
        throw new Error("qlik_source_changed");
      if (kind !== "catalog" && sourceRows !== null && count < sourceRows) {
        if (count !== Math.min(initial.rows + ROW_BUDGET, sourceRows))
          throw new Error("Extração Qlik incompleta.");
        await checked(
          db
            .from("operational_imports")
            .update({ continuation_ready: true })
            .eq("id", run),
        );
        return reply({
          ok: true,
          partial: true,
          kind,
          run_id: run,
          rows: count,
          expected_rows: sourceRows,
        });
      }
      if (
        kind !== "catalog" &&
        (count !== sourceRows ||
          sourceTotal === null ||
          Math.abs(total - sourceTotal) > Math.max(0.01, count * 0.000001))
      )
        throw new Error(
          "O detalhamento não confere com o total do indicador do Qlik.",
        );
      await checked(
        db
          .from("operational_imports")
          .update({ row_count: count, total: Math.round(total * 1e6) / 1e6 })
          .eq("id", run),
      );
    }
    let ready = kind === "catalog";
    for (let batch = 0; batch < 5 && !ready; batch++)
      ready = await checked(
        db.rpc("prepare_initial_operational_publication", {
          p_run: run,
          p_batch: 2000,
        }),
      );
    if (!ready) {
      await checked(
        db.from("operational_imports")
          .update({ continuation_ready: true, attempts: 0 })
          .eq("id", run),
      );
      return reply({
        ok: true,
        partial: true,
        phase: "publication",
        kind,
        rows: count,
        expected_rows: sourceRows,
      });
    }
    await checked(
      db.rpc("publish_operational_import", {
        p_run: run,
        p_count: count,
        p_total: Math.round(total * 1e6) / 1e6,
      }),
    );
    return reply({
      ok: true,
      partial: false,
      kind,
      rows: count,
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
    const transient =
      /(lock timeout|statement timeout|schema cache|connection|fetch failed|network)/i.test(
        message,
      ) && info.attempts < 12;
    await checked(
      retryImportWrite(() =>
        db
          .from("operational_imports")
          .update({
            status: transient ? "running" : "error",
            continuation_ready: transient,
            error: message,
            finished_at: transient ? null : new Date().toISOString(),
          })
          .eq("id", run)
          .eq("status", "running"),
      ),
    );
    await checked(
      retryImportWrite(() =>
        db
          .from("data_connections")
          .update({
            last_error: message,
            last_error_at: new Date().toISOString(),
          })
          .eq("slug", "qlik-operations"),
      ),
    );
    let retry = transient;
    if (message === "qlik_source_changed") {
      const failures = await db
        .from("operational_imports")
        .select("id", { count: "exact", head: true })
        .eq("kind", kind)
        .eq("error", message)
        .gte("started_at", new Date(Date.now() - 3600000).toISOString());
      retry = !failures.error && (failures.count || 0) < 3;
    }
    return reply(
      { error: message, retry, kind, preserved_previous: true },
      502,
    );
  }
}
