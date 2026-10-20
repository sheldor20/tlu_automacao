"use client";

import { RentalContractUpload } from "@/components/rental-contract-upload";
import type { RentalContractDraft, RentalContractFile } from "@/lib/rental-contracts";
import { RentalQlikReceipts } from "@/components/rental-qlik-receipts";
import { RentalReceipts } from "@/components/rental-receipts";
import { Button, Field, KpiCard, StatusPill, Toast } from "@/components/ui";
import { currency, dateBr, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { LessorType, Rental, RentalStatus } from "@/lib/types";
import { ArrowLeft, CalendarRange, CircleDollarSign, Home, Save } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";

const statusLabel: Record<RentalStatus, string> = {
  alugado: "Alugado",
  desocupado: "Desocupado",
  aguardando_reforma: "Aguardando reforma",
};

function rentalToForm(rental: Rental) {
  return {
    property_address: rental.property_address,
    status: rental.status,
    monthly_rent: String(rental.monthly_rent),
    lessor_type: rental.lessor_type,
    lessor_name: rental.lessor_name,
    lease_start_date: rental.lease_start_date || "",
    lease_end_date: rental.lease_end_date || "",
    annual_adjustment_percent: String(rental.annual_adjustment_percent),
    notes: rental.notes || "",
    tenant_name: rental.tenant_name || "",
    due_day: rental.due_day ? String(rental.due_day) : "",
    adjustment_index: rental.adjustment_index || "",
    renewal_terms: rental.renewal_terms || "",
    iptu_payer: rental.iptu_payer || "unknown",
    iptu_clause: rental.iptu_clause || "",
  };
}

export default function RentalDetailPage() {
  const params = useParams<{ id: string }>();
  const supabase = getSupabase();
  const [rental, setRental] = useState<Rental | null>(null);
  const [form, setForm] = useState<ReturnType<typeof rentalToForm> | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<RentalContractFile[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadRental = useCallback(async () => {
    if (!supabase || !params.id) return;
    setLoading(true);
    const { data, error } = await supabase.from("rentals").select("*").eq("id", params.id).single();
    if (error || !data) {
      setToast({ message: friendlyError(error || "Imóvel não encontrado."), type: "error" });
      setLoading(false);
      return;
    }
    const item = data as Rental;
    setRental(item);
    setForm(rentalToForm(item));
    setFiles([]); setWarnings([]);
    setLoading(false);
  }, [params.id, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRental(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRental]);

  async function saveRental(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !form || !rental) return;
    setSaving(true);
    const changes = {
      property_address: form.property_address.trim(),
      status: form.status,
      monthly_rent: Number(form.monthly_rent || 0),
      lessor_type: form.lessor_type,
      lessor_name: form.lessor_name.trim(),
      lease_start_date: form.lease_start_date || null,
      lease_end_date: form.lease_end_date || null,
      annual_adjustment_percent: Number(form.annual_adjustment_percent || 0),
      notes: form.notes.trim() || null,
      tenant_name: form.tenant_name.trim() || null,
      due_day: form.due_day ? Number(form.due_day) : null,
      adjustment_index: form.adjustment_index.trim() || null,
      renewal_terms: form.renewal_terms.trim() || null,
      iptu_payer: form.iptu_payer,
      iptu_clause: form.iptu_clause.trim() || null,
    };
    const { error } = files.length
      ? await supabase.rpc("save_rental_contract", { p_rental_id: rental.id, p_expected_updated_at: rental.updated_at, p_contract: changes, p_files: files })
      : await supabase.from("rentals").update(changes).eq("id", rental.id);
    if (error?.message.includes("rental_conflict")) {
      setSaving(false); setToast({ message: "O imóvel foi alterado por outra pessoa. Recarregue a página e revise antes de salvar.", type: "error" }); return;
    }
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Contrato e locação atualizados.", type: "success" });
    await loadRental();
  }

  function applyDraft(draft: RentalContractDraft) {
    setWarnings(draft.warnings);
    setForm(previous => {
      if (!previous) return previous;
      const next = { ...previous };
      for (const key of ["property_address", "lessor_name", "lessor_type", "tenant_name", "lease_start_date", "lease_end_date", "adjustment_index", "renewal_terms", "iptu_clause"] as const) {
        if (draft[key] !== null) Object.assign(next, { [key]: draft[key] });
      }
      for (const key of ["monthly_rent", "due_day", "annual_adjustment_percent"] as const) {
        if (draft[key] !== null) next[key] = String(draft[key]);
      }
      if (draft.lease_start_date && draft.lease_start_date <= todayIso() && (!draft.lease_end_date || draft.lease_end_date >= todayIso())) next.status = "alugado";
      if (draft.iptu_payer !== "unknown") next.iptu_payer = draft.iptu_payer;
      return next;
    });
  }

  if (loading) return <div className="detail-loading">Carregando imóvel…</div>;
  if (!rental || !form) return <div className="detail-loading">Imóvel não encontrado.</div>;

  return (
    <>
      <Link href="/alugueis" className="detail-back"><ArrowLeft size={15} /> Voltar para Aluguéis</Link>

      <header className="rental-detail-header">
        <div>
          <div className="work-detail-tags"><StatusPill tone={form.status === "alugado" ? "success" : form.status === "aguardando_reforma" ? "warning" : "neutral"}>{statusLabel[form.status]}</StatusPill><StatusPill tone="neutral">{form.lessor_type.toUpperCase()}</StatusPill>{form.iptu_payer === "tlu" ? <StatusPill tone="warning">IPTU · TLU</StatusPill> : null}</div>
          <h1>{rental.name}</h1>
          <p><Home size={14} /> {form.property_address}</p>
          <p>Cód. Imóvel: {rental.qlik_property_id || "Contrato anterior · vínculo pendente"}</p>
          <p>{rental.qlik_synced_at ? `Qlik atualizado em ${dateBr(rental.qlik_synced_at.slice(0, 10))}` : "Aguardando vínculo com a origem Qlik"}{rental.qlik_present === false ? " · Ausente na última carga" : ""}</p>
        </div>
      </header>

      <section className="kpi-grid rental-detail-kpis rental-contract-kpis">
        <KpiCard label="Valor mensal da locação" value={currency(Number(form.monthly_rent || 0))} helper={`base do contrato · ${form.adjustment_index || `reajuste de ${Number(form.annual_adjustment_percent || 0).toFixed(2)}% a.a.`}`} icon={<CircleDollarSign size={17} />} />
        <KpiCard label="Vigência" value={dateBr(form.lease_end_date)} helper={`início ${dateBr(form.lease_start_date)}`} icon={<CalendarRange size={17} />} />
      </section>

      <RentalContractUpload key={rental.updated_at} rentalId={rental.id} refreshKey={rental.updated_at} busy={saving} onBusy={setReading} onFiles={setFiles} onDraft={applyDraft} onError={message => setToast({ message, type: "error" })} />
      {warnings.length ? <div className="content-card content-card-body" role="status"><strong>Confira os pontos encontrados na leitura</strong><ul>{warnings.map((warning,i) => <li key={i}>{warning}</li>)}</ul></div> : null}
      <section className="content-card rental-edit-card">
        <div className="content-card-head"><div><h2>Dados da locação</h2><p>Revise os dados do contrato antes de salvar. Nome, tipo e permissão para locação vêm do Qlik.</p></div></div>
        <div className="content-card-body">
          <form className="form-grid" onSubmit={saveRental}>
            <Field label="Tipo de imóvel" hint="Informado pelo Qlik."><input value={rental.property_type || "Aguardando vínculo"} readOnly /></Field>
            <Field label="Pode ser locado?" hint="Informado pelo Qlik, independente da ocupação atual."><input value={rental.rentable === null ? "Aguardando vínculo" : rental.rentable ? "Sim" : "Não"} readOnly /></Field>
            <Field label="Ocupação"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as RentalStatus })}><option value="alugado">Alugado</option><option value="desocupado">Desocupado</option><option value="aguardando_reforma">Aguardando reforma</option></select></Field>
            <Field label="Endereço do imóvel" className="form-span-2"><input value={form.property_address} onChange={(event) => setForm({ ...form, property_address: event.target.value })} maxLength={260} required /></Field>
            <Field label="Valor mensal da locação"><input type="number" min="0" step="0.01" value={form.monthly_rent} onChange={(event) => setForm({ ...form, monthly_rent: event.target.value })} required /></Field>
            <Field label="Reajuste anual (%)" hint="Referência do contrato; não altera os recebimentos já lançados."><input type="number" min="0" max="100" step="0.01" value={form.annual_adjustment_percent} onChange={(event) => setForm({ ...form, annual_adjustment_percent: event.target.value })} /></Field>
            <Field label="Tipo do locador"><select value={form.lessor_type} onChange={(event) => setForm({ ...form, lessor_type: event.target.value as LessorType })}><option value="pf">Pessoa física</option><option value="pj">Pessoa jurídica</option></select></Field>
            <Field label="Nome do locador"><input value={form.lessor_name} onChange={(event) => setForm({ ...form, lessor_name: event.target.value })} maxLength={160} required /></Field>
            <Field label="Locatário"><input value={form.tenant_name} onChange={event => setForm({ ...form, tenant_name: event.target.value })} maxLength={500} /></Field>
            <Field label="Dia do vencimento"><input type="number" min="1" max="31" value={form.due_day} onChange={event => setForm({ ...form, due_day: event.target.value })} /></Field>
            <Field label="Índice de reajuste"><input value={form.adjustment_index} onChange={event => setForm({ ...form, adjustment_index: event.target.value })} maxLength={160} placeholder="Ex.: IGP-M ou IPCA" /></Field>
            <Field label="Quem paga o IPTU?"><select value={form.iptu_payer} onChange={event => setForm({ ...form, iptu_payer: event.target.value as typeof form.iptu_payer })}><option value="unknown">Não identificado</option><option value="tlu">TLU / locador</option><option value="tenant">Locatário</option><option value="shared">Compartilhado</option></select></Field>
            <Field label="Renovação do contrato" className="form-span-2"><textarea maxLength={3000} value={form.renewal_terms} onChange={event => setForm({ ...form, renewal_terms: event.target.value })} /></Field>
            <Field label="Cláusula do IPTU / referência" className="form-span-2"><textarea maxLength={3000} value={form.iptu_clause} onChange={event => setForm({ ...form, iptu_clause: event.target.value })} /></Field>
            <Field label="Início da locação"><input type="date" value={form.lease_start_date} onChange={(event) => setForm({ ...form, lease_start_date: event.target.value })} required={form.status === "alugado"} /></Field>
            <Field label="Término da locação"><input type="date" min={form.lease_start_date || undefined} value={form.lease_end_date} onChange={(event) => setForm({ ...form, lease_end_date: event.target.value })} /></Field>
            <Field label="Observações" className="form-span-2"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={3000} /></Field>
            <div className="form-actions"><Button type="submit" loading={saving} disabled={reading}><Save size={16} /> {files.length ? "Salvar nova versão do contrato" : "Salvar alterações"}</Button></div>
          </form>
        </div>
      </section>

      <RentalQlikReceipts rentalId={rental.id} />
      <RentalReceipts rentalId={rental.id} />

      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
