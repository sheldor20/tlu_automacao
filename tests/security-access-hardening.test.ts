import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const emailRoute = readFileSync(new URL("../app/api/projects/status-email/route.ts", import.meta.url), "utf8");
const chatRoute = readFileSync(new URL("../app/api/processes/chat/route.ts", import.meta.url), "utf8");
const publicWorkPage = readFileSync(new URL("../app/obra-publica/[token]/page.tsx", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../public/public-work-sw.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260828120000_security_access_hardening.sql", import.meta.url), "utf8");

test("restringe o envio de status e protege seu registro de auditoria", () => {
  assert.match(emailRoute, /rpc\("has_project_full_access", \{ p_project_id: projectId \}\)/);
  assert.match(emailRoute, /status: 403/);
  assert.match(emailRoute, /dispatchResult\.error/);
  assert.match(migration, /create policy email_dispatches_read[\s\S]*has_project_full_access\(project_id\)/);
  assert.match(migration, /sent_by = auth\.uid\(\)/);
});

test("revoga documentos públicos em cache quando o link deixa de ser válido", () => {
  const clearCache = serviceWorker.match(/async function clearPublicWorkCache[\s\S]*?\n}\n\nasync function networkFirst/)?.[0] || "";
  assert.match(clearCache, /\[DOCUMENT_CACHE, ASSET_CACHE\]/);
  assert.match(clearCache, /\/api\/public\/obras\/\$\{token\}\//);
  assert.match(serviceWorker, /async function networkFirstPublicPlan/);
  assert.match(serviceWorker, /\[401, 403, 404, 410\]\.includes\(response\.status\)/);
  assert.match(serviceWorker, /event\.respondWith\(networkFirstPublicPlan\(request\)\)/);
  assert.match(publicWorkPage, /if \(response\.status >= 500\)[\s\S]*clearPublicWorkOfflineData\(token\)/);
  assert.match(publicWorkPage, /type: "CLEAR_PUBLIC_WORK_CACHE", token/);
});

test("revoga escrita da RA sem departamento e mantém liderança de projeto somente leitura", () => {
  assert.match(migration, /create or replace function public\.can_administer_ra_meeting[\s\S]*public\.has_department_access\('pauta-ra'\)/);
  assert.match(migration, /create or replace function public\.can_manage_ra_meeting/);

  const updatePolicy = migration.match(/create policy project_tasks_update[\s\S]*?create policy project_tasks_delete/)?.[0] || "";
  const deletePolicy = migration.match(/create policy project_tasks_delete[\s\S]*?commit;/)?.[0] || "";
  assert.match(updatePolicy, /public\.has_department_access\('projetos'\)/);
  assert.doesNotMatch(updatePolicy, /is_direct_leader_of/);
  assert.match(deletePolicy, /public\.has_department_access\('projetos'\)/);
  assert.doesNotMatch(deletePolicy, /is_direct_leader_of/);
});

test("não mantém o conteúdo do chat de processos como estado da Responses API", () => {
  assert.match(chatRoute, /store: false/);
});
