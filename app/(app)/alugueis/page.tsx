"use client";

import { RentalQlikReceipts } from "@/components/rental-qlik-receipts";
import { RentalReceipts } from "@/components/rental-receipts";
import { EmptyState, KpiCard, PageIntro, Toast } from "@/components/ui";
import { ListToolbar } from "@/components/list-toolbar";
import { currency, dateBr, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Rental, RentalStatus } from "@/lib/types";
import {
  ArrowUpRight,
  Building2,
  Hammer,
  Home,
  KeyRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const statusLabel: Record<RentalStatus, string> = {
  alugado: "Alugado",
  desocupado: "Desocupado",
  aguardando_reforma: "Aguardando reforma",
};

export default function RentalsPage() {
  const supabase = getSupabase();
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RentalStatus | "all">("all");
  const [exceptionOnly, setExceptionOnly] = useState(false);
  const [rentableFilter, setRentableFilter] = useState("all");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from("rentals").select("*").order("name");
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
  const visibleRentals = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const now = new Date(`${todayIso()}T12:00:00`).getTime();
    return rentals.filter((rental) => {
      const daysToEnd = rental.lease_end_date ? Math.ceil((new Date(`${rental.lease_end_date}T12:00:00`).getTime() - now) / 86_400_000) : Number.POSITIVE_INFINITY;
      const exception = rental.status === "desocupado" || (rental.status === "alugado" && daysToEnd >= 0 && daysToEnd <= 60);
      const matchesSearch = !normalized || [rental.name, rental.qlik_property_id, rental.property_address, rental.property_type, rental.lessor_name].some((value) => value?.toLocaleLowerCase("pt-BR").includes(normalized));
      return matchesSearch && (rentableFilter === "all" || (rentableFilter === "unknown" ? rental.rentable === null : String(rental.rentable) === rentableFilter)) && (statusFilter === "all" || rental.status === statusFilter) && (!exceptionOnly || exception);
    });
  }, [exceptionOnly, query, rentals, statusFilter, rentableFilter]);

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
        description="Imóveis, contratos e recebimentos lançados mês a mês."
      />

      <section className="kpi-grid">
        <KpiCard label="Imóveis na carteira" value={String(rentals.length)} helper="carteira total" icon={<Building2 size={17} />} />
        <KpiCard label="Alugados" value={String(metrics.rented)} helper="contratos ativos" tone="success" icon={<KeyRound size={17} />} />
        <KpiCard label="Desocupados" value={String(metrics.available)} helper="sem ocupação atual" icon={<Home size={17} />} />
        <KpiCard label="Aguardando reforma" value={String(metrics.renovation)} helper="imóveis em preparação" icon={<Hammer size={17} />} />
      </section>

      <section className="content-card rentals-list-card">
        <div className="content-card-head project-list-head">
          <div><h2>Todos os imóveis</h2><p>Consulte tipo, permissão de locação, ocupação e contrato de cada imóvel</p></div>
        </div>
        <ListToolbar query={query} onQueryChange={setQuery} placeholder="Buscar por imóvel, código, tipo, endereço ou locador">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RentalStatus | "all")} aria-label="Filtrar por status"><option value="all">Todos os status</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={rentableFilter} onChange={(event) => setRentableFilter(event.target.value)} aria-label="Filtrar permissão de locação"><option value="all">Todos: permissão de locação</option><option value="true">Pode ser locado</option><option value="false">Não pode ser locado</option><option value="unknown">Permissão não informada</option></select>
          <label className="filter-check"><input type="checkbox" checked={exceptionOnly} onChange={(event) => setExceptionOnly(event.target.checked)} /> Somente exceções</label>
        </ListToolbar>
        {loading ? (
          <div className="list-loading">Carregando imóveis…</div>
        ) : visibleRentals.length === 0 ? (
          <EmptyState
            icon={<Home size={23} />}
            title="Nenhum imóvel encontrado"
            description="Os imóveis são importados do Qlik. Confira os filtros ou aguarde a primeira carga validada."
          />
        ) : (
          <div className="rental-table-wrap">
            <table className="data-table rental-table">
              <thead><tr><th>Imóvel</th><th>Tipo</th><th>Pode ser locado?</th><th>Ocupação</th><th>Valor mensal da locação</th><th>Locador</th><th>Contrato</th><th aria-label="Acessar" /></tr></thead>
              <tbody>
                {visibleRentals.map((rental) => {
                  const endInDays = rental.lease_end_date ? Math.ceil((new Date(`${rental.lease_end_date}T12:00:00`).getTime() - new Date(`${todayIso()}T12:00:00`).getTime()) / 86_400_000) : Number.POSITIVE_INFINITY;
                  const exception = rental.status === "desocupado" || (rental.status === "alugado" && endInDays >= 0 && endInDays <= 60);
                  return <tr key={rental.id} className={exception ? "exception-row" : ""}>
                    <td><strong>{rental.name}</strong><small>{rental.property_address}</small>{rental.qlik_property_id ? <small>Cód. Imóvel: {rental.qlik_property_id}</small> : <small>Contrato anterior · vínculo pendente</small>}{rental.qlik_present === false ? <small>Ausente na última carga do Qlik</small> : null}</td>
                    <td>{rental.property_type || "Não informado"}</td>
                    <td>{rental.rentable === null ? "Não informado" : rental.rentable ? "Sim" : "Não"}</td>
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
                    <td><strong>{rental.lessor_name}</strong><small>{rental.lessor_type.toUpperCase()}</small></td>
                    <td><strong>{dateBr(rental.lease_start_date)}</strong><small>{endInDays >= 0 && endInDays <= 60 ? `vence em ${endInDays} dia(s)` : `até ${dateBr(rental.lease_end_date)}`}</small></td>
                    <td><div className="table-actions"><Link className="table-action" href={`/alugueis/${rental.id}`} aria-label={`Acessar ${rental.name}`} title="Abrir imóvel"><ArrowUpRight size={16} /></Link></div></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RentalQlikReceipts />

      {!loading ? <RentalReceipts key={rentals.map((rental) => rental.id).sort().join(",")} /> : null}

      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
