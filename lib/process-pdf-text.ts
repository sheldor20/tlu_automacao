export function usableProcessText(pages: {text: string; imageCount: number; drawingCount: number}[]): string | null {
  if (!pages.length || pages.some(page => page.text.trim().length < 80 || page.imageCount > 0 || page.drawingCount > 10 || page.text.includes("\uFFFD"))) return null;
  const text = pages.map((page,index) => `Página ${index + 1}\n${page.text}`).join("\n\n");
  return text.length <= 80000 ? text : null;
}
export async function processPdfText(bytes: Uint8Array): Promise<string | null> {
  let document;
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = pdf.getDocument({ data: bytes.slice(), useSystemFonts: true });
    cleanup = () => loading.destroy();
    document = await loading.promise;
    const pages = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
      const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
      pages.push({ text,
        imageCount: operators.fnArray.filter(op => [pdf.OPS.paintImageXObject, pdf.OPS.paintInlineImageXObject, pdf.OPS.paintImageMaskXObject].includes(op)).length,
        drawingCount: operators.fnArray.filter(op => [pdf.OPS.constructPath, pdf.OPS.stroke, pdf.OPS.fill].includes(op)).length });
    }
    return usableProcessText(pages);
  } catch { return null; } finally { await cleanup?.().catch(() => undefined); }
}
