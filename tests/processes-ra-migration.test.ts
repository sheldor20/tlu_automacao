import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260821170000_processes_and_ra.sql", import.meta.url), "utf8");
const projectsPage = readFileSync(new URL("../app/(app)/projetos/page.tsx", import.meta.url), "utf8");
const raPage = readFileSync(new URL("../app/(app)/pauta-ra/page.tsx", import.meta.url), "utf8");
const closeRoute = readFileSync(new URL("../app/api/ra/[id]/close/route.ts", import.meta.url), "utf8");

test("separa visualização e gestão dos processos", () => {
  assert.match(migration, /create table public\.profile_process_permissions/);
  assert.match(migration, /create or replace function public\.can_manage_processes/);
  assert.match(migration, /status = 'publicado' or public\.can_manage_processes\(\)/);
});

test("restringe a RA ao líder e aos participantes", () => {
  assert.match(migration, /create or replace function public\.can_access_ra_meeting/);
  assert.match(migration, /meeting\.leader_user_id = auth\.uid\(\)/);
  assert.match(migration, /participant\.user_id = auth\.uid\(\)/);
});

test("converte item da RA em tarefa somente para participante", () => {
  assert.match(migration, /create or replace function public\.convert_ra_item_to_task/);
  assert.match(migration, /ra_assignee_must_be_participant/);
  assert.match(migration, /insert into public\.project_tasks/);
});

test("persiste tópicos iniciais na pauta ao criar a RA", () => {
  assert.match(raPage, /initial_topics/);
  assert.match(raPage, /ra_agenda_items/);
  assert.match(raPage, /title: "Assuntos gerais"/);
  assert.match(raPage, /submitTaskConversion/);
  assert.doesNotMatch(raPage, /disabled=\{!item\.owner_user_id \|\| !item\.due_date\}/);
});

test("encerra e persiste a ATA antes de tentar o envio", () => {
  assert.match(closeRoute, /ATA – REUNIÃO RA/);
  assert.match(closeRoute, /api\.resend\.com\/emails/);
  assert.match(closeRoute, /status: "encerrada"/);
  assert.ok(closeRoute.indexOf("const closeResult") < closeRoute.indexOf("const emailResponse"));
  assert.doesNotMatch(closeRoute, /if \(!resendKey \|\| !from\) return/);
  assert.match(closeRoute, /emailSent/);
  assert.match(closeRoute, /emailWarning/);
  assert.match(closeRoute, /AbortSignal\.timeout/);
  assert.match(closeRoute, /neq\("status", "encerrada"\)/);
});

test("remove o gerador antigo de pauta da página de projetos", () => {
  assert.doesNotMatch(projectsPage, /Gerar pauta de reunião/);
  assert.doesNotMatch(projectsPage, /meeting-agenda/);
});
