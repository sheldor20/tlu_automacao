"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Dialog, Field, PageIntro } from "@/components/ui";
import { legalActionEditableKeys, legalActionFields, legalActionStatuses, type LegalAction } from "@/lib/distrato-legal-actions";
import { paymentFetch } from "@/lib/payment-client";
import "./legal-actions.css";

const endpoint = "/api/distratos/acoes";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function displayValue(value: string, type?: "money" | "date") {
  if (!value) return "—";
  if (type === "money" && /^\d+(\.\d+)?$/.test(value)) return money.format(Number(value));
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/");
  return value;
}

export default function LegalActionsReportPage() {
  const [actions, setActions] = useState<LegalAction[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [selected, setSelected] = useState<LegalAction | "new" | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    paymentFetch(endpoint, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setActions(data.actions);
      setCanWrite(data.canWrite);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setLoadError(error.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  const visible = useMemo(() => {
    const search = normalize(query.trim());
    const digits = /^[\d.\s/-]+$/.test(search) ? search.replace(/\D/g, "") : "";
    return actions.filter(action => {
      if (status === "active" ? action.status === "ARQUIVADO" : action.status !== status) return false;
      return !search || normalize([action.protocol, ...Object.values(action.details)].join(" ")).includes(search) ||
        (!!digits && action.protocol.replace(/\D/g, "").includes(digits));
    }).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.protocol.localeCompare(b.protocol, "pt-BR"));
  }, [actions, query, status]);
  const active = actions.filter(action => action.status !== "ARQUIVADO").length;

  function save(action: LegalAction) {
    setActions(current => [action, ...current.filter(item => item.id !== action.id)]);
    setStatus(action.status === "ARQUIVADO" ? "ARQUIVADO" : "active");
    setQuery("");
    setSelected(null);
    setNotice("Ação salva com sucesso.");
  }

  return (
    <>
      <PageIntro eyebrow="Jurídico" title="Relatório de Ações"
        description="Cadastre processos judiciais e acompanhe o status e os andamentos de cada ação." />
      {loading && <p role="status">Carregando ações…</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {notice && <p role="status">{notice}</p>}
      {!loading && !loadError && <section className="legal-report" aria-label="Ações judiciais">
        <div className="legal-report-toolbar">
          <div><strong>{active}</strong> ações ativas</div>
          {canWrite && <Button onClick={() => { setNotice(""); setSelected("new"); }}>Nova ação</Button>}
        </div>
        <div className="legal-report-filters">
          <Field label="Buscar ação">
            <input type="search" value={query} onChange={event => setQuery(event.target.value)}
              placeholder="Processo, parte, comarca ou empreendimento" />
          </Field>
          <Field label="Status">
            <select value={status} onChange={event => setStatus(event.target.value)}>
              <option value="active">Todas as ativas</option>
              {legalActionStatuses.map(item => <option key={item}>{item}</option>)}
            </select>
          </Field>
        </div>
        <div className="legal-report-table">
          <table>
            <thead><tr><th scope="col">Processo</th><th scope="col">Natureza e comarca</th>
              <th scope="col">Partes</th><th scope="col">Status</th></tr></thead>
            <tbody>{visible.map(action => (
              <tr key={action.id}>
                <td><button type="button" className="legal-report-link" onClick={() => setSelected(action)}>{action.protocol}</button></td>
                <td>{action.details.nature}<small>{action.details.district}</small></td>
                <td>{action.details.plaintiff}<small>Réu · {action.details.defendant}</small></td>
                <td><span className="legal-report-status">{action.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
          {!visible.length && <p className="legal-report-empty">Nenhuma ação encontrada para esses filtros.</p>}
        </div>
      </section>}
      {selected && <ActionDialog key={selected === "new" ? selected : selected.id}
        action={selected === "new" ? null : selected} canWrite={canWrite} onClose={() => setSelected(null)} onSave={save} />}
    </>
  );
}

function ActionDialog({ action, canWrite, onClose, onSave }: {
  action: LegalAction | null;
  canWrite: boolean;
  onClose: () => void;
  onSave: (action: LegalAction) => void;
}) {
  const [id] = useState(() => action?.id || crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !canWrite) return;
    setError("");
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? "").trim();
    const tracking = { id, status: read("status"), observations: read("observations") };
    const details = Object.fromEntries(legalActionFields.flatMap(field => {
      if (action && !form.has(field.key)) return [];
      const value = read(field.key);
      if (action && value === (action.details[field.key] ?? "")) return [];
      const localizedMoney = "type" in field && field.type === "money" &&
        /^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(value);
      return [[field.key, localizedMoney ? value.replace(/\./g, "").replace(",", ".") : value]];
    }));
    const payload = action
      ? { ...tracking, revision: action.revision, details }
      : { ...tracking, protocol: read("protocol"), details };
    try {
      const data = await paymentFetch(endpoint, { method: action ? "PATCH" : "POST", body: JSON.stringify(payload) });
      onSave(data.action);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao salvar a ação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open wide title={action?.protocol ?? "Nova ação judicial"} onClose={saving ? () => {} : onClose}>
      <form className="legal-action-form" onSubmit={submit}>
        <div className="legal-action-grid">
          {!action && <Field label="Protocolo / número do processo">
            <input name="protocol" required maxLength={120} autoFocus />
          </Field>}
          {legalActionFields.map(field => {
            const type = "type" in field ? field.type : undefined;
            const value = action?.details[field.key] ?? "";
            if (action && (!canWrite || !legalActionEditableKeys.some(key => key === field.key))) {
              return <dl key={field.key}><dt>{field.label}</dt><dd>{displayValue(value, type)}</dd></dl>;
            }
            return <Field key={field.key} label={field.label}>
              <input name={field.key} type={type === "date" ? "date" : "text"} maxLength={500}
                inputMode={type === "money" ? "decimal" : undefined} required={"required" in field}
                defaultValue={value} readOnly={saving} />
            </Field>;
          })}
        </div>
        <Field label="Status do processo">
          <select name="status" disabled={!canWrite || saving} defaultValue={action?.status ?? legalActionStatuses[0]}>
            {legalActionStatuses.map(item => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Observações e andamentos processuais">
          <textarea name="observations" rows={6} maxLength={12000} readOnly={!canWrite || saving}
            defaultValue={action?.observations} placeholder={canWrite ? "Registre a data e o andamento do processo." : undefined} />
        </Field>
        {error && <p role="alert">{error}</p>}
        <div className="legal-action-buttons">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>{canWrite ? "Cancelar" : "Fechar"}</Button>
          {canWrite && <Button type="submit" loading={saving}>{action ? "Salvar alterações" : "Cadastrar ação"}</Button>}
        </div>
      </form>
    </Dialog>
  );
}
