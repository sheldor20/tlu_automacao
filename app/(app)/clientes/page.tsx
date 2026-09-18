import { ClientsWorkspace } from "@/components/clients-workspace";
import {
  CLIENT_FINANCIAL_LABELS,
  CLIENT_FINANCIAL_DESCRIPTIONS,
  type ClientFinancialStatus,
} from "@/lib/client-workspace";
import "./client-status.css";

export default function Page() {
  return (
    <>
      <ClientsWorkspace />
      <details className="client-status-legend">
        <summary>Como os status dos clientes são definidos</summary>
        <dl>
          {(Object.keys(CLIENT_FINANCIAL_LABELS) as ClientFinancialStatus[]).map((status) => (
            <div key={status}>
              <dt>{CLIENT_FINANCIAL_LABELS[status]}</dt>
              <dd>{CLIENT_FINANCIAL_DESCRIPTIONS[status]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}
