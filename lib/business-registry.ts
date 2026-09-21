export const MAX_REGISTRY_BYTES = 20 * 1024 * 1024;

// Match only a number explicitly labelled as a matrícula, never a CPF, CNM or protocolo.
export function registrationNumberFromText(value: string): string | null {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const match = normalized.match(/matricula\s*(?:(?:n(?:umero|ro)?\.?\s*[º°o]?|[º°])\s*)?[:#-]?\s*(\d{1,3}(?:\.\d{3})+|\d{1,9})(?![\d./-])/i);
  return match?.[1] || null;
}

export async function validateRegistryFile(file: File) {
  if (!/\.pdf$/i.test(file.name) || file.size === 0 || file.size > MAX_REGISTRY_BYTES) {
    throw new Error("Selecione um PDF de matrícula válido, com até 20 MB.");
  }
  const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...signature) !== "%PDF-") throw new Error("O arquivo selecionado não é um PDF válido.");
}

export async function validateAreaImage(file: File) {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) || !file.size || file.size > MAX_REGISTRY_BYTES) {
    throw new Error("A imagem da área deve ser PNG, JPG ou WebP, com até 20 MB.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
  } catch {
    throw new Error("Não foi possível abrir a imagem da área. Selecione uma imagem válida.");
  } finally { URL.revokeObjectURL(url); }
}

export async function suggestRegistrationNumber(file: File): Promise<{ number: string | null; source: "pdf" | "filename" | null }> {
  await validateRegistryFile(file);
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const text = await page.getTextContent();
    const number = registrationNumberFromText(text.items.map((item) => "str" in item ? item.str : "").join(" "));
    if (number) return { number, source: "pdf" };
  } catch {
    // Scans and password-protected documents still allow manual number entry.
  } finally {
    await task.destroy();
  }
  const number = registrationNumberFromText(file.name);
  return { number, source: number ? "filename" : null };
}
