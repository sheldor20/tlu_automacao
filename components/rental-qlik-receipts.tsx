"use client";

import { useEffect, useState } from "react";
import { TrendChart } from "@/components/management-charts";
import { Button, Field, KpiCard } from "@/components/ui";
import { currency, dateBr, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import { monthNames } from "@/lib/rental-receipts";
import "./rental-receipts.css";

type MonthlyQlikReceipt = { reference_month: string; received_amount: number; property_count: number };
type Connection = { active: boolean; last_success_at: string | null; last_error_at: string | null };

export function RentalQlikReceipts({ rentalId }: { rentalId?: string }) {
  const [period, setPeriod] = useState(() => todayIso().slice(0,7));
  const year = Number(period.slice(0,4));
  return <section className="content-card rental-receipts-card">
    <div className="content-card-head rental-receipts-head"><div><h2>Recebimentos do Qlik</h2><p>{rentalId ? "Recebimentos financeiros vinculados ao código deste imóvel." : "Recebimentos financeiros dos imóveis da carteira."}</p></div>
      <Field label="Período do histórico Qlik"><input type="month" min="1900-01" max="9999-12" value={period} onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value) && Number(event.target.value.slice(0,4))>=1900) setPeriod(event.target.value); }} /></Field>
    </div>
    <QlikReceiptYear key={`${rentalId || "all"}-${year}`} rentalId={rentalId} year={year} />
  </section>;
}

function QlikReceiptYear({ rentalId,year }: { rentalId?: string;year: number }) {
  const supabase = getSupabase();
  const [rows,setRows] = useState<MonthlyQlikReceipt[]>([]);
  const [connection,setConnection] = useState<Connection | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string | null>(null);
  const [retry,setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) { setError("Conexão indisponível.");setLoading(false);return; }
      const [data,source] = await Promise.all([
        supabase.rpc("rental_qlik_receipt_totals",{p_year:year,p_rental_id:rentalId || null}),
        supabase.from("data_connections").select("active,last_success_at,last_error_at").eq("slug","qlik-rental-receipts").maybeSingle(),
      ]);
      if (!active) return;
      if (data.error || source.error) setError(friendlyError(data.error || source.error));
      else { setRows(data.data as MonthlyQlikReceipt[]);setConnection(source.data); }
      setLoading(false);
    }
    void load();return () => { active=false; };
  },[rentalId,year,supabase,retry]);
  const byMonth = new Map(rows.map((row) => [row.reference_month,Number(row.received_amount)]));
  const months = monthNames.map((label,index) => ({label,value:byMonth.get(`${year}-${String(index+1).padStart(2,"0")}-01`) ?? null}));
  return <div className="content-card-body">
    {loading ? <div className="list-loading">Carregando recebimentos do Qlik…</div> : error ? <div role="alert"><p>{error}</p><Button variant="secondary" onClick={() => {setError(null);setLoading(true);setRetry((value) => value+1);}}>Tentar novamente</Button></div> : <>
      <p className="rental-receipt-hint" role="status">{connection?.active ? "Atualização diária às 6h30 de Brasília." : "Importação aguardando validação do vínculo Cód. Imóvel ↔ Cód Unidade Negócio."}{connection?.last_success_at ? ` Última atualização: ${dateBr(connection.last_success_at.slice(0,10))}.` : " Nenhuma carga confirmada ainda."}{connection?.last_error_at ? " Houve falha na última tentativa; confira a data da carga exibida." : ""}</p>
      <KpiCard label={`Recebido no Qlik · ${year}`} value={rows.length ? currency(rows.reduce((sum,row) => sum+Math.round(Number(row.received_amount)*100),0)/100) : "—"} helper="Total financeiro importado; não é somado aos lançamentos manuais." />
      <TrendChart labels={months.map((m) => m.label.slice(0,3))} series={[{label:"Recebido no Qlik",color:"#405343",values:months.map((m) => m.value)}]} compact wide connectMissing={false} emptyLabel="Sem recebimentos importados para este ano" maximumFractionDigits={2} />
      <div className="rental-table-wrap"><table className="data-table"><caption>Recebimentos do Qlik por mês · {year}</caption><thead><tr><th>Mês</th><th>Valor recebido</th></tr></thead><tbody>{months.map((m) => <tr key={m.label}><th scope="row">{m.label}</th><td>{m.value === null ? "Sem valor importado" : currency(m.value)}</td></tr>)}</tbody></table></div>
    </>}
  </div>;
}
