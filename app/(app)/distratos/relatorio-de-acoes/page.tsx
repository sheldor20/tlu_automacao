"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Dialog, Field, PageIntro } from "@/components/ui";
import { legalActionEditableKeys, legalActionFields, legalActionStatuses, type LegalAction } from "@/lib/distrato-legal-actions";
import { legalReportColumns, buildLegalActionsWorkbook } from "@/lib/distrato-legal-report";
import { paymentFetch } from "@/lib/payment-client";
import "./legal-actions.css";

const endpoint = "/api/distratos/acoes";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
type ColumnFilters = Partial<Record<(typeof legalReportColumns)[number]["key"], string>>;

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
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [selected, setSelected] = useState<LegalAction | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

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

  const columnOptions = useMemo(() => legalReportColumns.map(({ key, label }) => ({
    key,
    label,
    options: [...new Set(actions.map(action => action.details[key]?.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "pt-BR")),
  })), [actions]);

  const visible = useMemo(() => {
    const search = normalize(query.trim());
    const digits = /^[\d.\s/-]+$/.test(search) ? search.replace(/\D/g, "") : "";
    return actions.filter(action => {
      if (status !== "all" && (status === "active" ? action.status === "ARQUIVADO" : action.status !== status)) return false;
      if (!legalReportColumns.every(({ key }) => !filters[key] || action.details[key]?.trim() === filters[key])) return false;
      return !search || normalize([action.protocol, ...Object.values(action.details)].join(" ")).includes(search) ||
        (!!digits && action.protocol.replace(/\D/g, "").includes(digits));
    }).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.protocol.localeCompare(b.protocol, "pt-BR"));
  }, [actions, query, status, filters]);
  const active = actions.filter(action => action.status !== "ARQUIVADO").length;
  const hasFilters = Boolean(query) || status !== "active" || Object.values(filters).some(Boolean);

  function clearFilters() {
    setQuery("");
    setStatus("active");
    setFilters({});
  }

  function save(action: LegalAction) {
    setActions(current => [action, ...current.filter(item => item.id !== action.id)]);
    clearFilters();
    setStatus(action.status === "ARQUIVADO" ? "ARQUIVADO" : "active");
    setSelected(null);
    setNotice("Ação salva com sucesso.");
  }

  async function exportVisible() {
    if (exporting || !visible.length) return;
    setExportError("");
    setExporting(true);
    try {
      const file = await buildLegalActionsWorkbook(visible);
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = "relatorio-de-acoes.xlsx";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError("Não foi possível exportar a planilha. Tente novamente.");
    } finally {
      setExporting(false);
    }
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
          <div className="legal-report-actions">
            <Button type="button" variant="secondary" loading={exporting} disabled={exporting || !visible.length} onClick={exportVisible}>
              Exportar Excel
            </Button>
            {canWrite && <Button onClick={() => { setNotice(""); setSelected("new"); }}>Nova ação</Button>}
          </div>
        </div>
        {exportError && <p role="alert">{exportError}</p>}
        <div className="legal-report-filters">
          <Field label="Buscar ação">
            <input type="search" value={query} onChange={event => setQuery(event.target.value)}
              placeholder="Processo, parte, comarca ou empreendimento" />
          </Field>
          <Field label="Status">
            <select value={status} onChange={event => setStatus(event.target.value)}>
              <option value="active">Todas as ativas</option>
              <option value="all">Todos os status</option>
              {legalActionStatuses.map(item => <option key={item}>{item}</option>)}
            </select>
          </Field>
        </div>
        <div className="legal-report-toolbar">
          <p className="legal-report-count" role="status">{visible.length} {visible.length === 1 ? "processo exibido" : "processos exibidos"}</p>
          {hasFilters && <Button type="button" variant="ghost" onClick={clearFilters}>Limpar filtros</Button>}
        </div>
        <div className="legal-report-table" role="region" aria-label="Tabela de processos judiciais" tabIndex={0}>
          <table>
            <thead><tr>
              <th scope="col">Processo</th>
              {columnOptions.map(({ key, label, options }) => (
                <th key={key} scope="col">
                  {label}
                  <select aria-label={`Filtrar por ${label.toLowerCase()}`} value={filters[key] ?? ""}
                    onChange={event => setFilters({ ...filters, [key]: event.target.value })}>
                    <option value="">Todos</option>
                    {options.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </th>
              ))}
              <th scope="col">Status</th>
            </tr></thead>
            <tbody>{visible.map(action => (
              <tr key={action.id}>
                <td>
                  <button type="button" className="legal-report-link" onClick={() => setSelected(action)}>{action.protocol}</button>
                  {canWrite && <div className="legal-report-edit">
                    <Button type="button" variant="secondary" aria-label={`Editar ação ${action.protocol}`} onClick={() => setSelected(action)}>
                      Editar
                    </Button>
                  </div>}
                </td>
                {legalReportColumns.map(({ key }) => <td key={key}>{action.details[key]?.trim() || "—"}</td>)}
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
