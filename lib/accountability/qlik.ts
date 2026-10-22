import { PDFDocument } from "pdf-lib";
import { renderRevenueTable } from "./revenue-pdf";
import { withQlikOperationalPage } from "../qlik-cloud";
import { QLIK_APP_ID, QLIK_SHEETS } from "./policy";
export const ACCOUNTABILITY_QLIK_URL = `https://terralotusurbanismo.us.qlikcloud.com/sense/app/${QLIK_APP_ID}/sheet/${QLIK_SHEETS[0]}/state/analysis`;
export async function exportAccountabilitySource(
  enterprise: string,
  year: number,
  month: number,
  probe = false,
) {
  const { accountabilityRuntime } = await import("./qlik-runtime");
  return withQlikOperationalPage(
    ACCOUNTABILITY_QLIK_URL,
    async (page, socketUrl, appId) => {
      const result = await page.evaluate(accountabilityRuntime, {
        socketUrl,
        appId,
        sheetIds: [...QLIK_SHEETS],
        enterprise,
        year,
        month,
        probe,
      });
      if (result.compositionPdf) {
        const composition = await PDFDocument.load(
          Buffer.from(result.compositionPdf, "base64"),
        );
        if (composition.getPageCount() !== QLIK_SHEETS.length)
          throw new Error(
            "A composição nativa não contém uma página completa para cada pasta solicitada.",
          );
        for (let i = 0; i < QLIK_SHEETS.length; i++) {
          const output = await PDFDocument.create();
          const [sourcePage] = await output.copyPages(composition, [i]);
          output.addPage(sourcePage);
          result.pdfs.push({
            sheetId: QLIK_SHEETS[i],
            base64: Buffer.from(await output.save()).toString("base64"),
          });
        }
      }
      const detailed = await renderRevenueTable(
        page,
        enterprise,
        result.period,
        result.revenueData,
      );
      if (!probe) {
        const item = result.pdfs.find(
          (p) => p.sheetId === "75b2309a-3d3f-4c25-b2a1-e8f52f9c590f",
        );
        if (!item) throw new Error("PDF de receita ausente.");
        const merged = await PDFDocument.load(
          Buffer.from(item.base64, "base64"),
        );
        const table = await PDFDocument.load(detailed);
        for (const p of await merged.copyPages(table, table.getPageIndices()))
          merged.addPage(p);
        item.base64 = Buffer.from(await merged.save()).toString("base64");
      }
      return {
        ...result,
        revenuePdf: probe ? detailed.toString("base64") : undefined,
      };
    },
    { enforceWebSecurity: true },
  );
}

