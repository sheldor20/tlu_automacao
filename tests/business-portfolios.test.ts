import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260908120000_new_business_portfolios_and_files.sql", import.meta.url), "utf8");
const portfolio = readFileSync(new URL("../components/new-business-portfolio.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");

test("separa os negócios nas três carteiras solicitadas", () => {
  assert.match(migration, /portfolio_section in \('prospeccao', 'esteira_negocios', 'landing_bank'\)/);
  assert.match(portfolio, /eq\("portfolio_section", section\)/);
  assert.match(shell, /BUSINESS_PORTFOLIO_SECTIONS/);
  assert.match(shell, /label: "Obras", href: "\/obras"/);
});

test("restringe a exclusão definitiva à Prospecção", () => {
  assert.match(migration, /prevent_business_delete_outside_prospecting/);
  assert.match(migration, /old\.portfolio_section <> 'prospeccao'/);
  assert.match(portfolio, /const allowDelete = section === "prospeccao"/);
});

test("permite mover uma área entre as três carteiras", () => {
  assert.match(portfolio, /update\(\{ portfolio_section: targetSection \}\)/);
  assert.match(portfolio, /title="Mover área"/);
  assert.match(portfolio, /BUSINESS_PORTFOLIO_SECTIONS\.filter/);
});

test("aceita anexos multimídia e localização KMZ", () => {
  assert.match(migration, /create table if not exists public\.business_files/);
  assert.match(migration, /mime_type like 'image\/%'/);
  assert.match(migration, /mime_type like 'video\/%'/);
  assert.match(migration, /application\/vnd\.google-earth\.kmz/);
  assert.match(portfolio, /accept="\.kmz,application\/vnd\.google-earth\.kmz"/);
  assert.match(portfolio, /googleMapsUrl/);
});
