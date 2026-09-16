"use client";

import { RentalQlikReceipts } from "@/components/rental-qlik-receipts";
import { RentalReceipts } from "@/components/rental-receipts";
import { Button, Field, KpiCard, StatusPill, Toast } from "@/components/ui";
import { currency, dateBr } from "@/lib/format";
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
  };
}

export default function RentalDetailPage() {
  const params = useParams<{ id: string }>();
  const supabase = getSupabase();
  const [rental, setRental] = useState<Rental | null>(null);
  const [form, setForm] = useState<ReturnType<typeof rentalToForm> | null>(null);
  const [loading, setLoading] = useState(true);
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
    const { error } = await supabase.from("rentals").update({
      property_address: form.property_address.trim(),
      status: form.status,
      monthly_rent: Number(form.monthly_rent || 0),
      lessor_type: form.lessor_type,
      lessor_name: form.lessor_name.trim(),
      lease_start_date: form.lease_start_date || null,
      lease_end_date: form.lease_end_date || null,
      annual_adjustment_percent: Number(form.annual_adjustment_percent || 0),
      notes: form.notes.trim() || null,
    }).eq("id", rental.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Contrato e locação atualizados.", type: "success" });
    await loadRental();
  }

  if (loading) return <div className="detail-loading">Carregando imóvel…</div>;
  if (!rental || !form) return <div className="detail-loading">Imóvel não encontrado.</div>;

  return (
    <>
      <Link href="/alugueis" className="detail-back"><ArrowLeft size={15} /> Voltar para Aluguéis</Link>

      <header className="rental-detail-header">
        <div>
          <div className="work-detail-tags"><StatusPill tone={form.status === "alugado" ? "success" : form.status === "aguardando_reforma" ? "warning" : "neutral"}>{statusLabel[form.status]}</StatusPill><StatusPill tone="neutral">{form.lessor_type.toUpperCase()}</StatusPill></div>
          <h1>{rental.name}</h1>
          <p><Home size={14} /> {form.property_address}</p>
          <p>Cód. Imóvel: {rental.qlik_property_id || "Contrato anterior · vínculo pendente"}</p>
          <p>{rental.qlik_synced_at ? `Qlik atualizado em ${dateBr(rental.qlik_synced_at.slice(0, 10))}` : "Aguardando vínculo com a origem Qlik"}{rental.qlik_present === false ? " · Ausente na última carga" : ""}</p>
        </div>
      </header>

      <section className="kpi-grid rental-detail-kpis rental-contract-kpis">
        <KpiCard label="Valor mensal da locação" value={currency(Number(form.monthly_rent || 0))} helper={`base do contrato · reajuste de ${Number(form.annual_adjustment_percent || 0).toFixed(2)}% a.a.`} icon={<CircleDollarSign size={17} />} />
        <KpiCard label="Vigência" value={dateBr(form.lease_end_date)} helper={`início ${dateBr(form.lease_start_date)}`} icon={<CalendarRange size={17} />} />
      </section>

      <section className="content-card rental-edit-card">
        <div className="content-card-head"><div><h2>Dados do imóvel</h2><p>Nome, tipo e permissão para locação são atualizados pelo Qlik. O valor mensal da locação continua como base do contrato.</p></div></div>
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
            <Field label="Início da locação"><input type="date" value={form.lease_start_date} onChange={(event) => setForm({ ...form, lease_start_date: event.target.value })} required={form.status === "alugado"} /></Field>
            <Field label="Término da locação"><input type="date" min={form.lease_start_date || undefined} value={form.lease_end_date} onChange={(event) => setForm({ ...form, lease_end_date: event.target.value })} /></Field>
            <Field label="Observações" className="form-span-2"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={3000} /></Field>
            <div className="form-actions"><Button type="submit" loading={saving}><Save size={16} /> Salvar alterações</Button></div>
          </form>
        </div>
      </section>

      <RentalQlikReceipts rentalId={rental.id} />
      <RentalReceipts rentalId={rental.id} />

      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
