"use client";

import { TrendChart } from "@/components/management-charts";
import { KpiCard } from "@/components/ui";
import { currency } from "@/lib/format";
import type { ManagementIndicatorValue } from "@/lib/types";
import { CircleDollarSign, Percent, TrendingDown } from "lucide-react";
import { useState } from "react";

export function VgvProjectionPanel({ values }: { values: ManagementIndicatorValue[] }) {
  const [readAt] = useState(() => Date.now());
  const totals = values.filter((row) => row.metric_key === "vgv_total_receber" && row.dimension_key === "total");
  const latest = totals.sort((a, b) => b.reference_month.localeCompare(a.reference_month))[0];
  // All cards and years must come from the same successful import.
  const snapshot = latest ? values.filter((row) => row.reference_month === latest.reference_month
    && row.metadata.synchronized_at === latest.metadata.synchronized_at) : [];
  const metric = (key: string) => snapshot.find((row) => row.metric_key === key && row.dimension_key === "total")?.value ?? null;
  const total = metric("vgv_total_receber");
  const rate = metric("vgv_inadimplencia_atual");
  const adjusted = metric("vgv_projetado_liquido");
  const annual = snapshot.filter((row) => row.metric_key === "vgv_saldo_anual" && /^\d{4}$/.test(row.dimension_key))
    .sort((a, b) => a.dimension_key.localeCompare(b.dimension_key));
  const synchronizedAt = typeof latest?.metadata.synchronized_at === "string" ? new Date(latest.metadata.synchronized_at) : null;
  const updated = synchronizedAt && Number.isFinite(synchronizedAt.getTime())
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(synchronizedAt)
    : null;
  const stale = synchronizedAt ? readAt - synchronizedAt.getTime() > 8 * 86_400_000 : false;
  const percent = rate === null ? "—" : `${rate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  const labels = annual.length ? ["Atual", ...annual.map((row) => row.dimension_key)] : [];

  return (
    <section className="vgv-projection management-view-stack" aria-label="VGV projetado futuro">
      <div className="management-kpi-grid vgv-kpi-grid">
        <KpiCard label="VGV total a receber" value={total === null ? "—" : currency(total)} helper="Grupo Empresa · Terra Lotus" icon={<CircleDollarSign size={18} />} />
        <KpiCard label="Inadimplência atual" value={percent} helper="Visão geral · Multi Análises no Qlik" tone="warning" icon={<Percent size={18} />} />
        <KpiCard label="VGV projetado após inadimplência" value={adjusted === null ? "—" : currency(adjusted)} helper={rate === null ? "Aguardando os dados da carteira" : `VGV a receber × (1 − ${percent})`} tone="success" icon={<TrendingDown size={18} />} />
      </div>
      <article className="management-panel vgv-projection-chart">
        <div className="management-panel-head">
          <div><span>Carteira Terra Lotus</span><h2>VGV projetado futuro</h2><p>Saldo a receber após os recebimentos previstos até o fim de cada ano. Valores em reais.</p></div>
          <div className="vgv-source-date">{updated ? `Atualizado em ${updated}` : "Aguardando primeira carga do Qlik"}{stale ? <strong>Atualização pendente</strong> : null}</div>
        </div>
        <TrendChart wide labels={labels} maximumFractionDigits={2} valueLabelInterval={Math.max(1, Math.ceil(labels.length / 7))} highlightLatest={false} emptyLabel="Os valores aparecerão após a sincronização validada do Qlik."
          series={[
            { label: "VGV a receber", color: "#405343", values: annual.length ? [total, ...annual.map((row) => row.value)] : [] },
            { label: "Após inadimplência", color: "#b3875b", values: annual.length ? [adjusted, ...annual.map((row) => typeof row.metadata.adjusted_balance === "number" ? row.metadata.adjusted_balance : null)] : [] },
          ]} />
        {annual.length ? <details className="vgv-annual-details"><summary>Ver valores por ano</summary>
          <div className="vgv-table-scroll"><table><caption>Recebimentos previstos e saldo remanescente por ano</caption><thead><tr><th scope="col">Ano</th><th scope="col">Recebimento previsto</th><th scope="col">Saldo ao fim do ano</th><th scope="col">Após inadimplência</th></tr></thead>
            <tbody>{annual.map((row) => <tr key={row.dimension_key}><th scope="row">{row.dimension_key}</th><td>{typeof row.metadata.receipts === "number" ? currency(row.metadata.receipts) : "—"}</td><td>{currency(row.value)}</td><td>{typeof row.metadata.adjusted_balance === "number" ? currency(row.metadata.adjusted_balance) : "—"}</td></tr>)}</tbody>
          </table></div>
        </details> : null}
        <p className="vgv-method">Projeção da carteira atual por Data Vencimento, sem novas vendas. A taxa geral de inadimplência do Qlik é mantida nos anos futuros como premissa de ajuste. {typeof latest?.metadata.overdue === "number" ? `${currency(latest.metadata.overdue)} já vencidos permanecem no saldo, sem data presumida de recuperação.` : ""}</p>
      </article>
    </section>
  );
}
