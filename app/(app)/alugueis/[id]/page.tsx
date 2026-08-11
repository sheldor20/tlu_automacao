"use client";

import { Button, Field, KpiCard, StatusPill, Toast } from "@/components/ui";
import { currency, dateBr } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { LessorType, Rental, RentalStatus } from "@/lib/types";
import { ArrowLeft, CalendarRange, CircleDollarSign, Home, Save, WalletCards } from "lucide-react";
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
    name: rental.name,
    property_address: rental.property_address,
    status: rental.status,
    monthly_rent: String(rental.monthly_rent),
    lessor_type: rental.lessor_type,
    lessor_name: rental.lessor_name,
    lease_start_date: rental.lease_start_date || "",
    lease_end_date: rental.lease_end_date || "",
    annual_adjustment_percent: String(rental.annual_adjustment_percent),
    broker_name: rental.broker_name || "",
    broker_commission: String(rental.broker_commission),
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
    if (Number(form.broker_commission || 0) > Number(form.monthly_rent || 0)) {
      setToast({ message: "A comissão mensal não pode ser maior que o valor da locação.", type: "error" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("rentals").update({
      name: form.name.trim(),
      property_address: form.property_address.trim(),
      status: form.status,
      monthly_rent: Number(form.monthly_rent || 0),
      lessor_type: form.lessor_type,
      lessor_name: form.lessor_name.trim(),
      lease_start_date: form.lease_start_date || null,
      lease_end_date: form.lease_end_date || null,
      annual_adjustment_percent: Number(form.annual_adjustment_percent || 0),
      broker_name: form.broker_name.trim() || null,
      broker_commission: Number(form.broker_commission || 0),
      notes: form.notes.trim() || null,
    }).eq("id", rental.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Dados do imóvel atualizados.", type: "success" });
    await loadRental();
  }

  if (loading) return <div className="detail-loading">Carregando imóvel…</div>;
  if (!rental || !form) return <div className="detail-loading">Imóvel não encontrado.</div>;

  const baseNet = Math.max(Number(form.monthly_rent || 0) - Number(form.broker_commission || 0), 0);

  return (
    <>
      <Link href="/alugueis" className="detail-back"><ArrowLeft size={15} /> Voltar para Aluguéis</Link>

      <header className="rental-detail-header">
        <div>
          <div className="work-detail-tags"><StatusPill tone={form.status === "alugado" ? "success" : form.status === "aguardando_reforma" ? "warning" : "neutral"}>{statusLabel[form.status]}</StatusPill><StatusPill tone="neutral">{form.lessor_type.toUpperCase()}</StatusPill></div>
          <h1>{form.name}</h1>
          <p><Home size={14} /> {form.property_address}</p>
        </div>
      </header>

      <section className="kpi-grid rental-detail-kpis">
        <KpiCard label="Locação mensal" value={currency(Number(form.monthly_rent || 0))} helper={`reajuste de ${Number(form.annual_adjustment_percent || 0).toFixed(2)}% a.a.`} icon={<CircleDollarSign size={17} />} />
        <KpiCard label="Comissão mensal" value={currency(Number(form.broker_commission || 0))} helper={form.broker_name || "sem corretor informado"} icon={<WalletCards size={17} />} />
        <KpiCard label="Resultado líquido base" value={currency(baseNet)} helper="antes dos próximos reajustes" tone="success" icon={<CircleDollarSign size={17} />} />
        <KpiCard label="Vigência" value={dateBr(form.lease_end_date)} helper={`início ${dateBr(form.lease_start_date)}`} icon={<CalendarRange size={17} />} />
      </section>

      <section className="content-card rental-edit-card">
        <div className="content-card-head"><div><h2>Dados do imóvel</h2><p>Edite o contrato, os valores, o locador e o corretor</p></div></div>
        <div className="content-card-body">
          <form className="form-grid" onSubmit={saveRental}>
            <Field label="Nome do imóvel"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={140} required /></Field>
            <Field label="Status"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as RentalStatus })}><option value="alugado">Alugado</option><option value="desocupado">Desocupado</option><option value="aguardando_reforma">Aguardando reforma</option></select></Field>
            <Field label="Endereço do imóvel" className="form-span-2"><input value={form.property_address} onChange={(event) => setForm({ ...form, property_address: event.target.value })} maxLength={260} required /></Field>
            <Field label="Valor mensal da locação"><input type="number" min="0" step="0.01" value={form.monthly_rent} onChange={(event) => setForm({ ...form, monthly_rent: event.target.value })} required /></Field>
            <Field label="Reajuste anual (%)" hint="Aplicado no aniversário do início do contrato."><input type="number" min="0" max="100" step="0.01" value={form.annual_adjustment_percent} onChange={(event) => setForm({ ...form, annual_adjustment_percent: event.target.value })} /></Field>
            <Field label="Tipo do locador"><select value={form.lessor_type} onChange={(event) => setForm({ ...form, lessor_type: event.target.value as LessorType })}><option value="pf">Pessoa física</option><option value="pj">Pessoa jurídica</option></select></Field>
            <Field label="Nome do locador"><input value={form.lessor_name} onChange={(event) => setForm({ ...form, lessor_name: event.target.value })} maxLength={160} required /></Field>
            <Field label="Início da locação"><input type="date" value={form.lease_start_date} onChange={(event) => setForm({ ...form, lease_start_date: event.target.value })} required={form.status === "alugado"} /></Field>
            <Field label="Término da locação"><input type="date" min={form.lease_start_date || undefined} value={form.lease_end_date} onChange={(event) => setForm({ ...form, lease_end_date: event.target.value })} /></Field>
            <Field label="Corretor de imóveis"><input value={form.broker_name} onChange={(event) => setForm({ ...form, broker_name: event.target.value })} maxLength={160} placeholder="Opcional" /></Field>
            <Field label="Comissão mensal do corretor"><input type="number" min="0" step="0.01" value={form.broker_commission} onChange={(event) => setForm({ ...form, broker_commission: event.target.value })} /></Field>
            <Field label="Observações" className="form-span-2"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={3000} /></Field>
            <div className="form-actions"><Button type="submit" loading={saving}><Save size={16} /> Salvar alterações</Button></div>
          </form>
        </div>
      </section>

      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
