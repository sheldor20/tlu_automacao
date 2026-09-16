"use client";

import "./rental-receipts.css";

import { useEffect, useState, type FormEvent } from "react";
import { CircleDollarSign, Pencil, Save, Trash2 } from "lucide-react";
import { Button, Dialog, Field, KpiCard, Toast } from "@/components/ui";
import { TrendChart } from "@/components/management-charts";
import { currency, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import {
  monthNames, parseReceiptForm, receiptFields, receiptForm, receiptFormula, receiptTotals, receiptYearMonths,
  type RentalReceipt, type ReceiptSummary,
} from "@/lib/rental-receipts";

export function RentalReceipts({ rentalId }: { rentalId?: string }) {
  const [period, setPeriod] = useState(() => todayIso().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const year = Number(period.slice(0, 4));
  return (
    <section className="content-card rental-receipts-card">
      <div className="content-card-head rental-receipts-head">
        <div>
          <h2>{rentalId ? "Recebimentos mensais" : "Recebimentos da carteira"}</h2>
          <p>{rentalId ? "Selecione o mês para lançar ou editar os valores recebidos." : "Total dos lançamentos de todos os imóveis, mês a mês. Abra um imóvel para lançar."}</p>
        </div>
        <Field label="Mês de referência">
          <input type="month" min="1900-01" max="9999-12" value={period} disabled={busy}
            onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value) && Number(event.target.value.slice(0, 4)) >= 1900) setPeriod(event.target.value); }} />
        </Field>
      </div>
      <ReceiptYear key={`${rentalId || "all"}-${year}`} rentalId={rentalId} year={year} period={period} onPeriodChange={setPeriod} onBusy={setBusy} />
    </section>
  );
}

function ReceiptYear({ rentalId, year, period, onPeriodChange, onBusy }: {
  rentalId?: string; year: number; period: string; onPeriodChange: (value: string) => void; onBusy: (value: boolean) => void;
}) {
  const supabase = getSupabase();
  const [receipts, setReceipts] = useState<RentalReceipt[]>([]);
  const [summaries, setSummaries] = useState<ReceiptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) { setError("Não foi possível conectar aos recebimentos."); setLoading(false); return; }
      const result = rentalId
        ? await supabase.from("rental_receipts").select("*").eq("rental_id", rentalId)
          .gte("reference_month", `${year}-01-01`).lte("reference_month", `${year}-12-01`).order("reference_month")
        : await supabase.rpc("rental_receipt_monthly_totals", { p_year: year });
      if (!active) return;
      if (result.error) setError(friendlyError(result.error));
      else if (rentalId) {
        const rows = result.data as RentalReceipt[];
        setReceipts(rows);
        setSummaries(rows.map((row) => ({ ...row, receipt_count: 1 })));
      } else setSummaries(result.data as ReceiptSummary[]);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [rentalId, year, supabase, revision]);

  function refresh(message?: string) {
    setLoading(true);
    setError(null);
    setRevision((value) => value + 1);
    if (message) setToast({ message, type: "success" });
  }
  function changeBusy(value: boolean) { setBusy(value); onBusy(value); }

  const months = receiptYearMonths(year, summaries);
  const selected = receipts.find((row) => row.reference_month === `${period}-01`);
  const totals = summaries.reduce((result, row) => {
    const amounts = receiptTotals(row);
    return { credits: result.credits + Math.round(amounts.credits * 100), deductions: result.deductions + Math.round(amounts.deductions * 100), net: result.net + Math.round(amounts.net * 100) };
  }, { credits: 0, deductions: 0, net: 0 });

  return <div className="content-card-body">
    {loading ? <div className="list-loading">Carregando recebimentos…</div> : error ? (
      <div role="alert" className="rental-receipt-error"><p>{error}</p><Button variant="secondary" onClick={() => refresh()}>Tentar novamente</Button></div>
    ) : <>
      {rentalId ? <ReceiptEditor key={`${period}-${selected?.updated_at || "new"}`} rentalId={rentalId} referenceMonth={`${period}-01`} receipt={selected} onSaved={refresh} onBusy={changeBusy} /> : null}
      <div className="rental-receipt-summary kpi-grid">
        <KpiCard label={`Entradas em ${year}`} value={summaries.length ? currency(totals.credits / 100) : "—"} helper="aluguel, multas e reembolsos" icon={<CircleDollarSign size={17} />} />
        <KpiCard label={`Descontos em ${year}`} value={summaries.length ? currency(totals.deductions / 100) : "—"} helper="administração, reserva e IPTU" />
        <KpiCard label={`Líquido em ${year}`} value={summaries.length ? currency(totals.net / 100) : "—"} helper={`${summaries.length} mês(es) com lançamento`} tone={totals.net >= 0 ? "success" : "warning"} />
      </div>
      <h3>Recebimentos mês a mês · {year}</h3>
      <p className="rental-receipt-hint">Valores em reais. Meses sem lançamento ficam sem valor no gráfico.</p>
      <TrendChart labels={months.map((month) => month.label.slice(0, 3))} series={[
        { label: "Aluguel recebido", color: "#a08c63", values: months.map((month) => month.row ? Number(month.row.rent_received) : null) },
        { label: "Líquido recebido", color: "#405343", values: months.map((month) => month.totals?.net ?? null) },
      ]} compact wide connectMissing={false} emptyLabel="Nenhum recebimento lançado neste ano" maximumFractionDigits={2} />
      <div className="rental-table-wrap">
        <table className="data-table rental-receipts-table">
          <caption>Histórico mensal de {year}{rentalId ? " do imóvel" : " de todos os imóveis"}</caption>
          <thead><tr><th>Mês</th><th>Aluguel recebido</th><th>Taxa de adm.</th><th>Fundo de reserva</th><th>Multas</th><th>Reembolsos</th><th>IPTU</th><th>Líquido</th>{rentalId ? <th>Ação</th> : <th>Imóveis lançados</th>}</tr></thead>
          <tbody>{months.map(({ label, referenceMonth, row, totals: amounts }) => <tr key={referenceMonth}>
            <th scope="row">{label}</th>
            {row ? <>
              {receiptFields.map(({ key }) => <td key={key}>{currency(Number(row[key]))}</td>)}
              <td><strong>{currency(amounts!.net)}</strong></td>
            </> : <td colSpan={7} className="rental-receipt-hint">Sem lançamento</td>}
            <td>{rentalId ? <button type="button" className="rental-receipt-edit" disabled={busy} onClick={() => {
              onPeriodChange(referenceMonth.slice(0, 7));
              document.getElementById("rental-receipt-editor")?.scrollIntoView({ behavior: "smooth", block: "center" });
            }} aria-label={`${row ? "Editar" : "Lançar"} recebimento de ${label} de ${year}`}><Pencil size={14} /> {row ? "Editar" : "Lançar"}</button> : row ? row.receipt_count : "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
    {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
  </div>;
}

function ReceiptEditor({ rentalId, referenceMonth, receipt, onSaved, onBusy }: {
  rentalId: string; referenceMonth: string; receipt?: RentalReceipt; onSaved: (message: string) => void; onBusy: (value: boolean) => void;
}) {
  const supabase = getSupabase();
  const [form, setForm] = useState(() => receiptForm(receipt));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = `${monthNames[Number(referenceMonth.slice(5, 7)) - 1]} de ${referenceMonth.slice(0, 4)}`;
  let preview: number | null = null;
  try { preview = receiptTotals(parseReceiptForm(form)).net; } catch { /* Incomplete amounts have no preview. */ }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase || saving) return;
    setError(null);
    let amounts;
    try { amounts = parseReceiptForm(form); } catch (error) { setError((error as Error).message); return; }
    setSaving(true); onBusy(true);
    try {
      const result = receipt
        ? await supabase.from("rental_receipts").update(amounts).eq("id", receipt.id).eq("rental_id", rentalId).eq("updated_at", receipt.updated_at).select("id").maybeSingle()
        : await supabase.from("rental_receipts").insert({ ...amounts, rental_id: rentalId, reference_month: referenceMonth }).select("id").single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("Este lançamento foi alterado em outra sessão. Recarregue a página antes de editar.");
      onSaved(`Recebimento de ${label.toLowerCase()} salvo.`);
    } catch (error) { setError(friendlyError(error)); }
    finally { setSaving(false); onBusy(false); }
  }

  async function remove() {
    if (!supabase || !receipt || saving) return;
    setSaving(true); onBusy(true); setError(null);
    try {
      const result = await supabase.from("rental_receipts").delete().eq("id", receipt.id).eq("rental_id", rentalId).eq("updated_at", receipt.updated_at).select("id").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("Este lançamento foi alterado em outra sessão. Recarregue a página.");
      onSaved(`Lançamento de ${label.toLowerCase()} excluído.`);
    } catch (error) { setError(friendlyError(error)); setDeleting(false); }
    finally { setSaving(false); onBusy(false); }
  }

  return <div id="rental-receipt-editor" className="rental-receipt-editor">
    <h3>{receipt ? "Editar recebimento" : "Lançar recebimento"} · {label}</h3>
    <p className="rental-receipt-hint">Um lançamento por mês e imóvel. Campos opcionais em branco valem zero. O valor mensal do contrato permanece independente.</p>
    <form className="form-grid" onSubmit={save}>
      {receiptFields.map((field) => <Field key={field.key} label={field.label} hint={field.key === "rent_received" ? "Valor bruto recebido de aluguel neste mês, antes dos descontos." : "Opcional"}>
        <input type="number" min="0" max="9999999999999.99" step="0.01" inputMode="decimal" required={field.key === "rent_received"} placeholder="0,00" disabled={saving} value={form[field.key]} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })} />
      </Field>)}
      <div className="rental-receipt-net form-span-2" aria-live="polite"><span>Líquido recebido</span><strong>{preview === null ? "—" : currency(preview)}</strong><p>{receiptFormula}</p></div>
      {error ? <p role="alert" className="field-error form-span-2">{error}</p> : null}
      <div className="form-actions">
        {receipt ? <Button type="button" variant="ghost" disabled={saving} onClick={() => setDeleting(true)}><Trash2 size={16} /> Excluir lançamento</Button> : null}
        <Button type="submit" loading={saving}><Save size={16} /> {receipt ? "Salvar recebimento" : "Lançar recebimento"}</Button>
      </div>
    </form>
    <Dialog open={deleting} onClose={() => { if (!saving) setDeleting(false); }} title="Excluir lançamento mensal?" description={`O recebimento de ${label.toLowerCase()} será removido do histórico e do gráfico.`}>
      <div className="form-actions"><Button variant="secondary" disabled={saving} onClick={() => setDeleting(false)}>Cancelar</Button><Button variant="danger" loading={saving} onClick={() => void remove()}>Excluir lançamento</Button></div>
    </Dialog>
  </div>;
}
