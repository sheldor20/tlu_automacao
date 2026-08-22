import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260822020000_archive_delete_processes_ra.sql", import.meta.url), "utf8");
const processPage = readFileSync(new URL("../app/(app)/processos/page.tsx", import.meta.url), "utf8");
const raPage = readFileSync(new URL("../app/(app)/pauta-ra/page.tsx", import.meta.url), "utf8");
const closeRoute = readFileSync(new URL("../app/api/ra/[id]/close/route.ts", import.meta.url), "utf8");

test("arquiva RA com autoria e congela as operações do histórico", () => {
  assert.match(migration, /add column if not exists archived_at timestamptz/);
  assert.match(migration, /add column if not exists archived_by uuid/);
  assert.match(migration, /create or replace function public\.can_administer_ra_meeting/);
  assert.match(migration, /meeting\.archived_at is null/);
  assert.match(closeRoute, /Restaure a RA arquivada/);
  assert.match(raPage, /canOperateSelected/);
  assert.match(raPage, /Histórico preservado em modo somente leitura/);
});

test("separa ativos e arquivados e permite restaurar", () => {
  assert.match(processPage, /eq\("status", "arquivado"\)/);
  assert.match(processPage, /neq\("status", "arquivado"\)/);
  assert.match(processPage, /Restaurar/);
  assert.match(raPage, /not\("archived_at", "is", null\)/);
  assert.match(raPage, /is\("archived_at", null\)/);
  assert.match(raPage, /Ver arquivadas/);
});

test("exige confirmação para exclusão definitiva e preserva tarefas da RA", () => {
  assert.match(processPage, /Excluir processo\?/);
  assert.match(processPage, /business_processes"\)\.delete\(\)/);
  assert.match(processPage, /process-documents"\)\.remove/);
  assert.match(raPage, /Excluir RA\?/);
  assert.match(raPage, /ra_meetings"\)\.delete\(\)/);
  assert.match(raPage, /Tarefas já criadas permanecem no sistema/);
  assert.doesNotMatch(migration, /delete from public\.project_tasks/);
});

test("mantém exclusão limitada aos gestores e limpa PDF mesmo após apagar o processo", () => {
  assert.match(migration, /create policy ra_meetings_delete/);
  assert.match(migration, /using \(public\.can_administer_ra_meeting\(id\)\)/);
  assert.match(migration, /create policy process_documents_storage_delete/);
  assert.match(migration, /bucket_id = 'process-documents'/);
  assert.match(migration, /public\.can_manage_processes\(\)/);
});
