import type { PerformanceContract, PerformanceContractAcceptance } from "./performance-agreements.ts";

export const PERFORMANCE_CONTRACT_TERMS = "O líder e o liderado registram neste instrumento as metas, os indicadores, os resultados esperados e os prazos do ciclo indicado. O líder se compromete a comunicar as expectativas e acompanhar a execução. O liderado declara ciência das condições e se compromete a atuar para alcançar as metas, comunicando impedimentos ao líder. As partes realizarão o acompanhamento durante a vigência. Qualquer alteração gera uma nova revisão, que exige novo registro de assinatura. Os documentos e as assinaturas de revisões anteriores são preservados para consulta. Este instrumento registra os compromissos de performance do ciclo e não altera, por si só, as condições do vínculo de trabalho.";

export const escapeDocumentText = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export const performanceDate = (value: string) => value.split("-").reverse().join("/");
export const performanceTimestamp = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Bahia" }).format(new Date(value));

export function performanceContractDocument(contract: PerformanceContract, acceptance?: PerformanceContractAcceptance, draft = false): string {
  const e = escapeDocumentText;
  const a = contract.snapshot;
  // A signature can only be displayed against the exact immutable document it accepts.
  const signed = acceptance?.contract_id === contract.id && acceptance.content_hash === contract.content_hash ? acceptance : undefined;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Acordo de Performance — ${e(a.cycle)}</title>
<style>
@page {size:A4;margin:20mm 18mm} *{box-sizing:border-box} body{font:11pt/1.55 Georgia,serif;color:#1d2921;margin:0 auto;padding:28px;max-width:850px} h1{font-size:24pt;line-height:1.15;margin:8px 0 18px}h2{font-size:14pt;margin:24px 0 8px}h3{font-size:12pt;margin:8px 0}p{margin:8px 0}.brand{font:700 11pt Arial,sans-serif;letter-spacing:2px}.meta{font:9pt/1.6 Arial,sans-serif;color:#56645b}.box{border:1px solid #cfd9d1;padding:14px;margin:12px 0}.text{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #cfd9d1;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{font:700 9pt Arial,sans-serif;background:#eff4ef}.signature{break-inside:avoid;margin-top:18px;border-top:1px solid #a8b8ad;padding-top:12px}footer{font:8pt/1.5 Arial,sans-serif;margin-top:24px;overflow-wrap:anywhere}.status{font-weight:bold} @media print{body{padding:0;max-width:none}thead{display:table-header-group}tr{break-inside:avoid}h2,h3{break-after:avoid}}
</style></head><body>
<div class="brand">TERRA LÓTUS · GESTÃO INTEGRADA</div><h1>Acordo de Performance</h1>
<p class="meta">Documento nº ${e(contract.id)} · Revisão ${contract.agreement_version}<br>Ciclo: ${e(a.cycle)}<br>Vigência: ${performanceDate(a.starts_on)} a ${performanceDate(a.ends_on)}</p>
<p class="status">${draft ? "MINUTA · Documento ainda não emitido ou assinado" : signed ? "Assinado por líder e liderado" : "Assinado pelo líder · Aguardando assinatura do liderado"}</p>
<h2>1. Partes</h2><div class="box"><p><strong>Líder:</strong> ${e(contract.leader_identity.full_name)}<br>${e(contract.leader_identity.email)}</p><p><strong>Liderado:</strong> ${e(contract.report_identity.full_name)}<br>${e(contract.report_identity.email)}</p></div>
<h2>2. Objeto e compromissos</h2><p class="text">${e(contract.terms)}</p>
<h2>3. Expectativas e observações</h2><p class="text">${e(a.expectations || "Sem observações adicionais.")}</p>
<h2>4. Entregáveis pactuados</h2><table><thead><tr><th>Entregável</th><th>Indicador</th><th>Resultado esperado</th><th>Prazo</th></tr></thead><tbody>${a.goals.map((g,i)=>`<tr><td class="text">${i+1}. ${e(g.title)}</td><td class="text">${e(g.indicator)}</td><td class="text">${e(g.expected_result)}</td><td>${performanceDate(g.due_date)}</td></tr>`).join("")}</tbody></table>
<h2>5. Assinaturas eletrônicas registradas no sistema</h2>
<div class="signature"><strong>Líder — ${e(draft ? "Não assinado" : contract.leader_signature_name)}</strong><p>${draft ? "Aguardando emissão e assinatura do líder." : `Emissão e assinatura: ${performanceTimestamp(contract.leader_signed_at)} (horário da Bahia).`}<br>Conta: ${e(contract.leader_identity.email)} · Identificador: ${e(contract.leader_user_id)}</p></div>
<div class="signature"><strong>Liderado — ${e(signed?.signature_name || "Aguardando assinatura")}</strong>${signed ? `<p class="text">${e(signed.statement)}</p><p>Assinatura: ${performanceTimestamp(signed.signed_at)} (horário da Bahia).<br>Local informado: ${e(signed.location_description)}${signed.latitude !== null && signed.longitude !== null ? `<br>Coordenadas autorizadas pelo usuário: ${signed.latitude}, ${signed.longitude}` : "<br>Coordenadas não registradas."}<br>Registro: ${e(signed.id)}</p>` : "<p>Não há assinatura do liderado registrada para este documento.</p>"}<p>Conta: ${e(contract.report_identity.email)} · Identificador: ${e(contract.report_user_id)}</p></div>
<footer>Documento preservado com o conteúdo desta revisão. Alterações no acordo exigem nova emissão e novas assinaturas.<br>Identificação do conteúdo (SHA-256): ${draft ? "Será registrada na emissão." : e(contract.content_hash)}<br>As assinaturas acima são registros de aceite em conta autenticada no Terra Lotus Space.</footer>
</body></html>`;
}
