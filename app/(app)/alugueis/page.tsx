"use client";

import { Button, Dialog, EmptyState, Field, KpiCard, PageIntro, Toast } from "@/components/ui";
import { currency, dateBr } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { LessorType, Rental, RentalStatus } from "@/lib/types";
import {
  ArrowUpRight,
  Building2,
  Hammer,
  Home,
  KeyRound,
  Percent,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const statusLabel: Record<RentalStatus, string> = {
  alugado: "Alugado",
  desocupado: "Desocupado",
  aguardando_reforma: "Aguardando reforma",
};

const emptyForm = {
  name: "",
  property_address: "",
  status: "desocupado" as RentalStatus,
  monthly_rent: "",
  lessor_type: "pf" as LessorType,
  lessor_name: "",
  lease_start_date: "",
  lease_end_date: "",
  annual_adjustment_percent: "0",
  broker_name: "",
  broker_commission: "0",
  notes: "",
};

export default function RentalsPage() {
  const supabase = getSupabase();
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("rentals")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) setToast({ message: friendlyError(error), type: "error" });
    setRentals((data || []) as Rental[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const metrics = useMemo(() => ({
    rented: rentals.filter((rental) => rental.status === "alugado").length,
    available: rentals.filter((rental) => rental.status === "desocupado").length,
    renovation: rentals.filter((rental) => rental.status === "aguardando_reforma").length,
  }), [rentals]);

  async function createRental(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (Number(form.broker_commission || 0) > Number(form.monthly_rent || 0)) {
      setToast({ message: "A comissão mensal não pode ser maior que o valor da locação.", type: "error" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("rentals").insert({
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
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setDialogOpen(false);
    setForm(emptyForm);
    setToast({ message: "Imóvel cadastrado no departamento de Aluguéis.", type: "success" });
    await loadData();
  }

  async function changeStatus(rental: Rental, status: RentalStatus) {
    if (!supabase || status === rental.status) return;
    if (status === "alugado" && !rental.lease_start_date) {
      setToast({ message: "Abra o imóvel e informe o início da locação antes de marcá-lo como alugado.", type: "error" });
      return;
    }
    const previous = rentals;
    setRentals((items) => items.map((item) => item.id === rental.id ? { ...item, status } : item));
    const { error } = await supabase.from("rentals").update({ status }).eq("id", rental.id);
    if (error) {
      setRentals(previous);
      setToast({ message: friendlyError(error), type: "error" });
      return;
    }
    setToast({ message: `Status alterado para ${statusLabel[status].toLowerCase()}.`, type: "success" });
    await loadData();
  }

  return (
    <>
      <PageIntro
        eyebrow="Departamento · Aluguéis"
        title="Gestão de aluguéis"
        description="Imóveis, contratos e situação de ocupação em uma visão direta."
        action={<Button onClick={() => setDialogOpen(true)}><Plus size={18} /> Novo imóvel</Button>}
      />

      <section className="kpi-grid">
        <KpiCard label="Imóveis cadastrados" value={String(rentals.length)} helper="carteira total" icon={<Building2 size={17} />} />
        <KpiCard label="Alugados" value={String(metrics.rented)} helper="contratos ativos" tone="success" icon={<KeyRound size={17} />} />
        <KpiCard label="Desocupados" value={String(metrics.available)} helper="disponíveis" icon={<Home size={17} />} />
        <KpiCard label="Aguardando reforma" value={String(metrics.renovation)} helper="imóveis em preparação" icon={<Hammer size={17} />} />
      </section>

      <section className="content-card rentals-list-card">
        <div className="content-card-head project-list-head">
          <div><h2>Todos os imóveis</h2><p>Altere o status na lista ou abra o imóvel para editar os demais dados</p></div>
        </div>
        {loading ? (
          <div className="list-loading">Carregando imóveis…</div>
        ) : rentals.length === 0 ? (
          <EmptyState
            icon={<Home size={23} />}
            title="Nenhum imóvel cadastrado"
            description="Cadastre o primeiro imóvel para acompanhar ocupação e contratos."
            action={<Button onClick={() => setDialogOpen(true)}><Plus size={17} /> Cadastrar imóvel</Button>}
          />
        ) : (
          <div className="rental-table-wrap">
            <table className="data-table rental-table">
              <thead><tr><th>Imóvel</th><th>Status</th><th>Locação</th><th>Líquido base</th><th>Locador</th><th>Contrato</th><th aria-label="Acessar" /></tr></thead>
              <tbody>
                {rentals.map((rental) => (
                  <tr key={rental.id}>
                    <td><strong>{rental.name}</strong><small>{rental.property_address}</small></td>
                    <td>
                      <div className={`rental-status-select rental-status-${rental.status}`}>
                        <span aria-hidden="true" />
                        <select value={rental.status} onChange={(event) => void changeStatus(rental, event.target.value as RentalStatus)} aria-label={`Status de ${rental.name}`}>
                          <option value="alugado">Alugado</option>
                          <option value="desocupado">Desocupado</option>
                          <option value="aguardando_reforma">Aguardando reforma</option>
                        </select>
                      </div>
                    </td>
                    <td><strong>{currency(rental.monthly_rent)}</strong><small>reajuste {Number(rental.annual_adjustment_percent || 0).toFixed(2)}% a.a.</small></td>
                    <td><strong>{currency(Math.max(Number(rental.monthly_rent) - Number(rental.broker_commission), 0))}</strong><small>- {currency(rental.broker_commission)} comissão</small></td>
                    <td><strong>{rental.lessor_name}</strong><small>{rental.lessor_type.toUpperCase()}</small></td>
                    <td><strong>{dateBr(rental.lease_start_date)}</strong><small>até {dateBr(rental.lease_end_date)}</small></td>
                    <td><Link className="table-action" href={`/alugueis/${rental.id}`} aria-label={`Acessar ${rental.name}`}><ArrowUpRight size={16} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Novo imóvel" description="Cadastre os dados da locação. Datas podem ficar em branco enquanto o imóvel estiver desocupado." wide>
        <form className="form-grid" onSubmit={createRental}>
          <Field label="Nome do imóvel"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={140} required /></Field>
          <Field label="Status"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as RentalStatus })}><option value="alugado">Alugado</option><option value="desocupado">Desocupado</option><option value="aguardando_reforma">Aguardando reforma</option></select></Field>
          <Field label="Endereço do imóvel" className="form-span-2"><input value={form.property_address} onChange={(event) => setForm({ ...form, property_address: event.target.value })} maxLength={260} required /></Field>
          <Field label="Valor mensal da locação"><input type="number" min="0" step="0.01" value={form.monthly_rent} onChange={(event) => setForm({ ...form, monthly_rent: event.target.value })} required /></Field>
          <Field label="Reajuste anual (%)" hint="Aplicado a cada aniversário do início do contrato."><input type="number" min="0" max="100" step="0.01" value={form.annual_adjustment_percent} onChange={(event) => setForm({ ...form, annual_adjustment_percent: event.target.value })} /></Field>
          <Field label="Tipo do locador"><select value={form.lessor_type} onChange={(event) => setForm({ ...form, lessor_type: event.target.value as LessorType })}><option value="pf">Pessoa física</option><option value="pj">Pessoa jurídica</option></select></Field>
          <Field label="Nome do locador"><input value={form.lessor_name} onChange={(event) => setForm({ ...form, lessor_name: event.target.value })} maxLength={160} required /></Field>
          <Field label="Início da locação"><input type="date" value={form.lease_start_date} onChange={(event) => setForm({ ...form, lease_start_date: event.target.value })} required={form.status === "alugado"} /></Field>
          <Field label="Término da locação"><input type="date" min={form.lease_start_date || undefined} value={form.lease_end_date} onChange={(event) => setForm({ ...form, lease_end_date: event.target.value })} /></Field>
          <Field label="Corretor de imóveis"><input value={form.broker_name} onChange={(event) => setForm({ ...form, broker_name: event.target.value })} maxLength={160} placeholder="Opcional" /></Field>
          <Field label="Comissão mensal do corretor"><input type="number" min="0" step="0.01" value={form.broker_commission} onChange={(event) => setForm({ ...form, broker_commission: event.target.value })} /></Field>
          <Field label="Observações" className="form-span-2"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={3000} /></Field>
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit" loading={saving}><Percent size={16} /> Cadastrar imóvel</Button></div>
        </form>
      </Dialog>

      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
