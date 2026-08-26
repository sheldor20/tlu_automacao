import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderRaMinutesEmail } from "../lib/ra.ts";

const migration = readFileSync(new URL("../supabase/migrations/20260826120000_ra_multiple_decisions.sql", import.meta.url), "utf8");
const raPage = readFileSync(new URL("../app/(app)/pauta-ra/page.tsx", import.meta.url), "utf8");
const closeRoute = readFileSync(new URL("../app/api/ra/[id]/close/route.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("permite várias definições para o mesmo assunto", () => {
  assert.match(migration, /drop constraint if exists ra_decisions_item_id_key/);
  assert.match(migration, /create index if not exists ra_decisions_item_idx/);
  assert.doesNotMatch(migration, /on conflict \(item_id\)/);
  assert.match(raPage, /Nova definição sobre este assunto/);
  assert.match(raPage, /\[item\.id\]: ""/);
  assert.match(raPage, /selectedDecisions\.filter\(\(decision\) => decision\.item_id === item\.id\)/);
  assert.match(closeRoute, /decisions\.filter\(\(decision\) => decision\.item_id === item\.id\)/);
});

test("permite editar e excluir assuntos da pauta", () => {
  assert.match(raPage, /function openItemEditor/);
  assert.match(raPage, /from\("ra_agenda_items"\)\.update\(\{ content \}\)/);
  assert.match(raPage, /from\("ra_agenda_items"\)\.delete\(\)\.eq\("id", deletingItem\.id\)/);
  assert.match(raPage, /title="Editar assunto"/);
  assert.match(raPage, /title="Excluir assunto\?"/);
});

test("aumenta a legibilidade da RA e da ATA enviada", () => {
  assert.match(styles, /\.ra-item-list strong \{ font-size: 13px/);
  assert.match(styles, /\.ra-minutes pre \{[^}]*font: 13px\/1\.65/);
  const email = renderRaMinutesEmail("ATA de teste");
  assert.match(email, /class="ra-document"[^>]*font-size:14px/);
});
