import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resumableStorageEndpoint } from "../lib/business-storage-upload.ts";
import {
  BUSINESS_PORTFOLIO_STAGE_KEYS,
  BUSINESS_STAGES,
  businessPortfolioSectionForStage,
} from "../lib/constants.ts";

const migration = readFileSync(new URL("../supabase/migrations/20260908120000_new_business_portfolios_and_files.sql", import.meta.url), "utf8");
const uploadFixMigration = readFileSync(new URL("../supabase/migrations/20260908150000_business_video_upload_limit.sql", import.meta.url), "utf8");
const stageMigration = readFileSync(new URL("../supabase/migrations/20260908170000_add_awaiting_business_stage.sql", import.meta.url), "utf8");
const funnelMigration = readFileSync(new URL("../supabase/migrations/20260908170100_single_business_funnel_by_stage.sql", import.meta.url), "utf8");
const portfolio = readFileSync(new URL("../components/new-business-portfolio.tsx", import.meta.url), "utf8");
const fileManager = readFileSync(new URL("../components/business-file-manager.tsx", import.meta.url), "utf8");
const storageUpload = readFileSync(new URL("../lib/business-storage-upload.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");

test("mantém os três menus de Novos Negócios", () => {
  assert.match(migration, /portfolio_section in \('prospeccao', 'esteira_negocios', 'landing_bank'\)/);
  assert.match(shell, /BUSINESS_PORTFOLIO_SECTIONS/);
  assert.match(shell, /label: "Obras", href: "\/obras"/);
});

test("particiona o funil único pela fase atual", () => {
  assert.deepEqual(BUSINESS_PORTFOLIO_STAGE_KEYS, {
    prospeccao: ["prospeccao", "viabilidade", "contrato", "viabilidade_mercadologica"],
    esteira_negocios: ["masterplan", "aprovacao", "obra"],
    landing_bank: ["aguardando"],
  });
  assert.equal(BUSINESS_STAGES[0].key, "aguardando");
  assert.equal(businessPortfolioSectionForStage("aguardando"), "landing_bank");
  assert.equal(businessPortfolioSectionForStage("contrato"), "prospeccao");
  assert.equal(businessPortfolioSectionForStage("obra"), "esteira_negocios");
  assert.match(portfolio, /\.in\("stage", \[\.\.\.sectionStageKeys\]\)/);
  assert.match(stageMigration, /add value if not exists 'aguardando' before 'prospeccao'/);
  assert.doesNotMatch(stageMigration, /business_portfolio_section_for_stage/);
  assert.doesNotMatch(funnelMigration, /add value if not exists 'aguardando'/);
  assert.match(funnelMigration, /before insert or update of stage, portfolio_section/);
  assert.match(funnelMigration, /new\.portfolio_section := public\.business_portfolio_section_for_stage\(new\.stage\)/);
});

test("restringe a exclusão definitiva à Prospecção", () => {
  assert.match(migration, /prevent_business_delete_outside_prospecting/);
  assert.match(funnelMigration, /business_portfolio_section_for_stage\(old\.stage\) <> 'prospeccao'/);
  assert.match(portfolio, /const allowDelete = section === "prospeccao"/);
});

test("move uma área de menu ao alterar sua fase", () => {
  assert.match(portfolio, /update\(\{ stage \}\)/);
  assert.match(portfolio, /businessPortfolioSectionForStage\(stage\)/);
  assert.doesNotMatch(portfolio, /update\(\{ portfolio_section: targetSection \}\)/);
  assert.doesNotMatch(portfolio, /title="Mover área"/);
});

test("carrega os 21 status individuais da planilha preservando fases compatíveis", () => {
  const importValues = funnelMigration.match(/insert into business_status_import[\s\S]*?values([\s\S]*?);/)?.[1] || "";
  const importedSections = [...importValues.matchAll(/, '(prospeccao|esteira_negocios|landing_bank)'\)/g)].map((match) => match[1]);
  assert.equal(importedSections.length, 21);
  assert.equal(importedSections.filter((section) => section === "prospeccao").length, 10);
  assert.equal(importedSections.filter((section) => section === "esteira_negocios").length, 5);
  assert.equal(importedSections.filter((section) => section === "landing_bank").length, 6);
  assert.match(funnelMigration, /when business\.stage in \('prospeccao', 'viabilidade', 'contrato', 'viabilidade_mercadologica'\) then business\.stage/);
  assert.match(funnelMigration, /when business\.stage in \('masterplan', 'aprovacao', 'obra'\) then business\.stage/);
  assert.match(funnelMigration, /when 'landing_bank' then 'aguardando'::public\.business_stage/);
});

test("permite abrir e fechar os submenus de Novos negócios", () => {
  assert.match(shell, /businessMenuOpen/);
  assert.match(shell, /aria-expanded=\{businessMenuOpen\}/);
  assert.match(shell, /hidden=\{!businessMenuOpen\}/);
});

test("aceita anexos multimídia e localização KMZ", () => {
  assert.match(migration, /create table if not exists public\.business_files/);
  assert.match(migration, /mime_type like 'image\/%'/);
  assert.match(migration, /mime_type like 'video\/%'/);
  assert.match(migration, /application\/vnd\.google-earth\.kmz/);
  assert.match(portfolio, /accept="\.kmz,application\/vnd\.google-earth\.kmz"/);
  assert.match(portfolio, /new Blob\(\[form\.kmz_file\], \{ type: "application\/vnd\.google-earth\.kmz" \}\)/);
  assert.match(portfolio, /googleMapsUrl/);
});

test("envia vídeos grandes de forma retomável", () => {
  assert.match(fileManager, /MAX_VIDEO_SIZE = 2 \* 1024 \* 1024 \* 1024/);
  assert.match(fileManager, /uploadBusinessStorageFile/);
  assert.match(storageUpload, /new Upload\(file/);
  assert.match(storageUpload, /chunkSize: RESUMABLE_CHUNK_SIZE/);
  assert.match(uploadFixMigration, /file_size_limit = 2147483648/);
  assert.equal(
    resumableStorageEndpoint("https://projeto.supabase.co"),
    "https://projeto.storage.supabase.co/storage/v1/upload/resumable",
  );
});
