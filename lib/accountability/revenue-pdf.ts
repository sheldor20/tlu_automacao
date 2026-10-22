import type { Page } from "puppeteer-core";
export type SourceRevenueTable = {
  headers: string[];
  rows: string[][];
  totals: string[];
  sourceRowCount: number;
};
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
/** Paginate exact Qlik-formatted strings; never parse, round or recompute financial cells. */
export async function renderRevenueTable(
  page: Page,
  enterprise: string,
  reference: string,
  table: SourceRevenueTable,
) {
  if (
    table.rows.length !== table.sourceRowCount ||
    table.rows.some((r) => r.length !== table.headers.length)
  )
    throw new Error(
      "A receita detalhada não contém todas as linhas e colunas da origem.",
    );
  const print = await page.browser().newPage();
  try {
    const cells = (row: string[], tag = "td") =>
      row.map((text) => `<${tag}>${escape(text)}</${tag}>`).join("");
    await print.setContent(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>@page{size:A3 landscape;margin:12mm}*{box-sizing:border-box}body{font:8.5pt Arial,sans-serif;color:#18251c}h1{font-size:16pt;margin:0 0 5mm}p{font-size:10pt;margin:0 0 3mm}.source{font-size:8pt;color:#52614f;margin-bottom:6mm}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th{background:#e6ece3;font-weight:600}th,td{border:0.3pt solid #cad3c5;padding:2mm 1.4mm;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}tr{break-inside:avoid}tbody tr:nth-child(even){background:#f5f7f3}.totals{font-weight:bold;background:#e6ece3}</style></head><body><h1>Receita Bruta Detalhada | DRE</h1><p>${escape(enterprise)} · ${escape(reference)}</p><p class="source">Tabela completa da origem Qlik · ${table.sourceRowCount} linhas. Valores e textos preservados conforme a formatação da origem.</p><table><thead><tr>${cells(table.headers, "th")}</tr></thead><tbody>${table.rows.map((r) => `<tr>${cells(r)}</tr>`).join("")}${table.totals.some(Boolean) ? `<tr class="totals">${cells(table.totals)}</tr>` : ""}</tbody></table></body></html>`,
      { waitUntil: "load", timeout: 30000 },
    );
    await print.evaluate(() => document.fonts.ready);
    return Buffer.from(
      await print.pdf({
        format: "A3",
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        timeout: 60000,
      }),
    );
  } finally {
    await print.close();
  }
}
