import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAccountabilityBook } from "./book";
const BUCKET = "accountability-books";
const hash = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
/** Preserve exactly the reviewed attachments across provider retries. */
export async function accountabilityArtifacts(
  service: SupabaseClient,
  id: string,
  enterprise: string,
  year: number,
  month: number,
  token: string,
) {
  const record = await service
    .from("accountability_dispatches")
    .select("pdf_path,excel_path,pdf_sha256,excel_sha256")
    .eq("id", id)
    .eq("processing_token", token)
    .eq("status", "processing")
    .single();
  if (record.error)
    throw new Error("Não foi possível consultar os anexos desta prestação.");
  const cached = record.data;
  const reference = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 15)));
  if (cached.pdf_path && cached.excel_path) {
    const [p, x] = await Promise.all([
      service.storage.from(BUCKET).download(cached.pdf_path),
      service.storage.from(BUCKET).download(cached.excel_path),
    ]);
    if (p.error || x.error || !p.data || !x.data)
      throw new Error("Não foi possível recuperar os anexos originais.");
    const pdf = Buffer.from(await p.data.arrayBuffer()),
      excel = Buffer.from(await x.data.arrayBuffer());
    if (hash(pdf) !== cached.pdf_sha256 || hash(excel) !== cached.excel_sha256)
      throw new Error(
        "Os anexos armazenados não correspondem à versão original. Envio cancelado.",
      );
    return { pdf, excel, reference };
  }
  const result = await createAccountabilityBook(enterprise, year, month);
  const root = `${id}/${crypto.randomUUID()}`,
    pdfPath = `${root}/book.pdf`,
    excelPath = `${root}/recebiveis.xlsx`;
  const [p, x] = await Promise.all([
    service.storage.from(BUCKET).upload(pdfPath, result.pdf, {
      contentType: "application/pdf",
      upsert: false,
    }),
    service.storage.from(BUCKET).upload(excelPath, result.excel, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    }),
  ]);
  if (p.error || x.error) {
    await service.storage.from(BUCKET).remove([pdfPath, excelPath]);
    throw new Error(
      "Não foi possível guardar os anexos originais. Nenhum e-mail foi enviado.",
    );
  }
  const saved = await service
    .from("accountability_dispatches")
    .update({
      pdf_path: pdfPath,
      excel_path: excelPath,
      pdf_sha256: hash(result.pdf),
      excel_sha256: hash(result.excel),
      source_revision: result.sourceRevision,
      generated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("processing_token", token)
    .eq("status", "processing")
    .is("provider_attempted_at", null)
    .select("id")
    .maybeSingle();
  if (saved.error || !saved.data) {
    // On an uncertain DB response the paths may have committed. Preserve bytes.
    if (!saved.error)
      await service.storage.from(BUCKET).remove([pdfPath, excelPath]);
    throw new Error("Não foi possível registrar os anexos originais.");
  }
  return result;
}
