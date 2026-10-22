/** BETA policy: recipient cannot be supplied or overridden by the browser. */
export const BETA_RECIPIENT = "rosangela@terralotusurbanismo.com.br" as const;
export const QLIK_APP_ID = "2ca99c6d-b779-4138-b552-f386dc702514";
export const QLIK_SHEETS = [
  "1bd358b4-e1ca-4dae-901b-bb0e87ea869f",
  "8df2799b-9868-4f8e-8927-f40f1031333b",
  "62a32512-dbd3-4492-b92e-34597b95651e",
  "9bcecff4-a137-4372-be49-eeb94c0da93b",
  "f338a466-5149-4d5a-8ef4-38e51593e855",
  "75b2309a-3d3f-4c25-b2a1-e8f52f9c590f",
  "dc3a2213-4e15-4bb9-b095-ee8ea7d05450",
  "a17158ba-2352-4e6c-89c8-e101e44bc3f0",
  "84eb6783-e4b1-4188-a44b-0213e0ad076c",
  "8f9a709f-a02a-4f53-9bea-5e7d0236d7d3",
  "5c3d8e7c-c499-4a14-9314-90bdf3c116d5",
  "72c1239d-0627-4a7c-9333-381af02bf4f6",
  "c7cd575a-4da9-41da-b97b-f7b87385fc9f",
] as const;
export function isHistoricalDispatch(year: number, month: number) {
  return year === 2026 && Number.isInteger(month) && month >= 1 && month <= 9;
}
export function canGenerateBook(
  year: number,
  month: number,
  qlikClosed: boolean,
  now = new Date(),
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const currentYear = Number(parts.find((p) => p.type === "year")?.value);
  const currentMonth = Number(parts.find((p) => p.type === "month")?.value);
  return (
    Number.isInteger(year) &&
    year === currentYear &&
    Number.isInteger(month) &&
    month >= 1 &&
    month < currentMonth &&
    qlikClosed
  );
}
export function monthlyEmail(enterprise: string, reference: string) {
  return {
    to: BETA_RECIPIENT,
    subject: `[BETA] Prestação de contas — ${enterprise} — ${reference}`,
    text: `Prezada Rosângela,\n\nSegue, para conferência em modo BETA, a prestação de contas de ${enterprise}, referente a ${reference}.\n\nAnexos: book com os relatórios originais do Qlik e planilha Excel com o detalhamento a receber. Os dados foram preservados integralmente; a organização inclui capa e contracapa.\n\nAtenciosamente,\nTerra Lotus Urbanismo`,
  };
}
