import type { LegalAction } from "./distrato-legal-actions";

export const legalReportColumns = [
  { key: "nature", label: "Natureza" },
  { key: "district", label: "Comarca" },
  { key: "plaintiff", label: "Autor" },
  { key: "defendant", label: "Réu" },
] as const;

const sheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const officeRelationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";

function cellText(value: string) {
  // Preserve literal Excel escape sequences and encode characters that XML cannot represent.
  return value.replace(/_x[\da-f]{4}_/gi, match => "_x005F_" + match.slice(1))
    .replace(/[\u0000-\u0008\u000b\u000c\u000d-\u001f\ud800-\udfff\ufffe\uffff]/gu,
      character => "_x" + character.charCodeAt(0).toString(16).padStart(4, "0") + "_")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function buildLegalActionsWorkbook(actions: readonly LegalAction[]) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const rows = [
    ["Processo", ...legalReportColumns.map(({ label }) => label), "Status"],
    ...actions.map(action => [
      action.protocol,
      ...legalReportColumns.map(({ key }) => action.details[key]?.trim() ?? ""),
      action.status,
    ]),
  ];
  const sheetData = rows.map((row, index) => {
    const cells = row.map(value => '<c t="inlineStr"><is><t xml:space="preserve">' + cellText(value) + '</t></is></c>');
    return '<row r="' + (index + 1) + '">' + cells.join("") + "</row>";
  }).join("");

  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="' + packageRelationships + '">' +
    '<Relationship Id="rId1" Type="' + officeRelationships + '/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file("xl/workbook.xml", '<workbook xmlns="' + sheetNamespace + '" xmlns:r="' + officeRelationships + '">' +
    '<sheets><sheet name="Ações judiciais" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="' + packageRelationships + '">' +
    '<Relationship Id="rId1" Type="' + officeRelationships + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/worksheets/sheet1.xml", '<worksheet xmlns="' + sheetNamespace + '">' +
    '<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="5" width="36" customWidth="1"/>' +
    '<col min="6" max="6" width="32" customWidth="1"/></cols>' +
    '<sheetData>' + sheetData + '</sheetData><autoFilter ref="A1:F' + rows.length + '"/></worksheet>');

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    compression: "DEFLATE",
  });
}
