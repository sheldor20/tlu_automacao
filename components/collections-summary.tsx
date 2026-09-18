import type { CollectionSummary } from "@/lib/collection-totals";
import { money } from "./operations-common";
import "./collections-summary.css";

export function CollectionsSummary({
  label,
  summary,
  ready,
  error,
  filtered,
}: {
  label: string;
  summary: CollectionSummary;
  ready: boolean;
  error: boolean;
  filtered: boolean;
}) {
  return (
    <section
      className="collections-summary"
      aria-label={`Total selecionado: ${label}`}
      aria-busy={!ready && !error}
      aria-live="polite"
      aria-atomic="true"
    >
      <div>
        <span className="collections-summary-eyebrow">Total selecionado</span>
        <h2>{label}</h2>
        <p>
          {filtered ? "Com os filtros aplicados · " : ""}Todos os contratos do grupo, em todas as páginas.
        </p>
      </div>
      <div className="collections-summary-value">
        <span>Saldo vencido</span>
        <strong>{ready ? money(summary.amount) : "—"}</strong>
        <small>
          {error
            ? "Não foi possível calcular o total. Tente atualizar."
            : !ready
              ? "Atualizando total…"
              : `${summary.contracts.toLocaleString("pt-BR")} ${summary.contracts === 1 ? "contrato" : "contratos"} · ${summary.installments.toLocaleString("pt-BR")} ${summary.installments === 1 ? "parcela vencida" : "parcelas vencidas"}`}
        </small>
      </div>
    </section>
  );
}
