import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAX_PROCESS_PDF_BYTES, isPdfUpload, processDraftJsonSchema, processDraftSchema, responseOutputText } from "../lib/process-pdf.ts";

const route = readFileSync(new URL("../app/api/processes/import/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260822010000_process_pdf_v1.sql", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/(app)/processos/page.tsx", import.meta.url), "utf8");

test("valida o PDF pelo nome, MIME, tamanho e assinatura", () => {
  const file = { name: "processo.pdf", type: "application/pdf", size: 1024 };
  assert.equal(isPdfUpload(file, new TextEncoder().encode("%PDF-")), true);
  assert.equal(isPdfUpload({ ...file, name: "processo.txt" }, new TextEncoder().encode("%PDF-")), false);
  assert.equal(isPdfUpload({ ...file, size: MAX_PROCESS_PDF_BYTES + 1 }, new TextEncoder().encode("%PDF-")), false);
  assert.equal(isPdfUpload(file, new TextEncoder().encode("texto")), false);
});

test("aceita somente uma versão 1 estruturada com ao menos uma etapa", () => {
  const draft = { title: "Compras", area: "Suprimentos", objective: "Padronizar compras.", rules: ["Exigir cotação."], policies: [], steps: [{ title: "Solicitar", description: "Registrar a demanda.", responsible_role: "Solicitante", business_rule: "" }] };
  assert.deepEqual(processDraftSchema.parse(draft), draft);
  assert.equal(processDraftSchema.safeParse({ ...draft, steps: [] }).success, false);
  assert.equal(processDraftJsonSchema.additionalProperties, false);
});

test("extrai a saída textual da Responses API", () => {
  assert.equal(responseOutputText({ output: [{ content: [{ type: "output_text", text: "{\"ok\":true}" }] }] }), '{"ok":true}');
  assert.equal(responseOutputText({ output_text: "direto" }), "direto");
});

test("usa PDF como input estruturado e mantém o documento privado", () => {
  assert.match(route, /type: "input_file"/);
  assert.match(route, /type: "json_schema"/);
  assert.match(route, /store: false/);
  assert.match(migration, /'process-documents', 'process-documents', false/);
  assert.match(migration, /add column if not exists version integer not null default 1/);
  assert.match(migration, /can_access_process_document_storage_object/);
  assert.match(page, /Gerar versão 1 por PDF/);
  assert.match(page, /createSignedUrl/);
  assert.match(page, /source_file_path/);
});
