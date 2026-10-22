"use client";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { BETA_RECIPIENT, canGenerateBook } from "@/lib/accountability/policy";
import { Button, Dialog } from "@/components/ui";
import { Check, FileText, RefreshCw, Send, ShieldCheck } from "lucide-react";
import "./accountability.css";
type Enterprise = { id: string; name: string };
type Dispatch = {
  historical_sent: boolean;
  id: string;
  enterprise_id: string;
  year: number;
  month: number;
  status: "historical" | "processing" | "sent_beta" | "failed" | "uncertain";
  error: string | null;
  sent_at: string | null;
};
type Period = { year: number; month: number; closed: boolean };
type State = {
  enterprises: Enterprise[];
  dispatches: Dispatch[];
  periods: Period[];
  isAdmin: boolean;
  configured: boolean;
};
const months = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];
function currentYear() {
  return Number(
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );
}
export default function AccountabilityPage() {
  const year = currentYear();
  const supabase = getSupabase();
  const [data, setData] = useState<State | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{
    enterprise: Enterprise;
    month: number;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      if (!supabase) throw new Error("Sessão indisponível.");
      const { data: session } = await supabase.auth.getSession();
      const response = await fetch(`/api/accountability?year=${year}`, {
        headers: {
          Authorization: `Bearer ${session.session?.access_token || ""}`,
        },
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível carregar os dados.",
      );
    } finally {
      setLoading(false);
    }
  }, [supabase, year]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!data?.dispatches.some((d) => d.status === "processing")) return;
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [data, load]);
  async function send() {
    if (!selected || !supabase) return;
    setBusy(true);
    setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const response = await fetch("/api/accountability", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: selected.enterprise.id,
          year,
          month: selected.month,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setNotice(
        body.processing
          ? "Geração iniciada. O status será atualizado automaticamente após o envio."
          : `Book e Excel enviados para ${BETA_RECIPIENT}.`,
      );
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setBusy(false);
      await load();
    }
  }
  async function closePeriod(month: number) {
    if (!supabase) return;
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Entre novamente.");
      const result = await supabase.from("accountability_periods").upsert({
        year,
        month,
        closed: true,
        confirmed_by: auth.user.id,
        confirmed_at: new Date().toISOString(),
      });
      if (result.error) throw result.error;
      await load();
    } catch {
      setError("Não foi possível confirmar o fechamento.");
    } finally {
      setBusy(false);
    }
  }
  const enterprises =
    data?.enterprises.filter((e) =>
      e.name
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
    ) || [];
  return (
    <div className="accountability-page">
      <header className="accountability-header">
        <div>
          <span className="accountability-eyebrow">
            TERRA LOTUS URBANISMO · FINANCEIRO
          </span>
          <h1>
            Prestação de contas{" "}
            <span className="accountability-beta">BETA</span>
          </h1>
          <p>Books mensais por empreendimento · {year}</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void load()}
          disabled={loading || busy}
        >
          <RefreshCw size={16} /> Atualizar
        </Button>
      </header>
      <div className="accountability-banner">
        <ShieldCheck size={22} />
        <div>
          <strong>Conferência interna</strong>
          <p>
            Todos os envios deste BETA vão exclusivamente para {BETA_RECIPIENT}.
            O book preserva os dados originais do Qlik e acompanha o Excel de
            recebíveis.
          </p>
        </div>
      </div>
      {error ? (
        <p className="accountability-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {loading ? (
        <p>Carregando prestação de contas…</p>
      ) : data ? (
        <>
          <div className="accountability-stats">
            <div>
              <strong>{data.enterprises.length}</strong>
              <span>Empreendimentos</span>
            </div>
            <div>
              <strong>
                {data.dispatches.filter((d) => d.historical_sent).length}
              </strong>
              <span>Envios históricos</span>
            </div>
            <div>
              <strong>
                {data.dispatches.filter((d) => d.status === "sent_beta").length}
              </strong>
              <span>Enviados no BETA</span>
            </div>
          </div>
          {!data.configured ? (
            <div className="accountability-integration" role="status">
              <strong>Exportação do Qlik em configuração</strong>
              <p>
                O painel e o histórico estão disponíveis. Os botões de envio
                serão habilitados quando a exportação automática dos PDFs e do
                Excel estiver conectada.
              </p>
            </div>
          ) : null}
          <div className="accountability-toolbar">
            <label>
              Buscar empreendimento
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nome do empreendimento"
              />
            </label>
            <span>
              <Check size={14} /> Histórico informado até setembro de 2026
            </span>
          </div>
          <div className="accountability-table-wrap">
            <table className="accountability-table">
              <caption>
                Controle de prestação de contas por empreendimento e mês de{" "}
                {year}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Empreendimento</th>
                  {months.map((label, i) => (
                    <th scope="col" key={label}>
                      <span>{label}</span>
                      {data.periods.some(
                        (p) => p.month === i + 1 && p.closed,
                      ) ? (
                        <small>Fechado</small>
                      ) : data.isAdmin && canGenerateBook(year, i + 1, true) ? (
                        <button
                          disabled={busy}
                          onClick={() => void closePeriod(i + 1)}
                          title="Confirmar que o mês está fechado para todos os empreendimentos"
                        >
                          Confirmar fechamento
                        </button>
                      ) : (
                        <small>Aberto</small>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enterprises.map((enterprise) => (
                  <tr key={enterprise.id}>
                    <th scope="row">
                      <FileText size={16} />
                      {enterprise.name}
                    </th>
                    {months.map((label, i) => {
                      const month = i + 1;
                      const dispatch = data.dispatches.find(
                        (d) =>
                          d.enterprise_id === enterprise.id &&
                          d.month === month,
                      );
                      const closed = data.periods.some(
                        (p) => p.month === month && p.closed,
                      );
                      const eligible = canGenerateBook(year, month, closed);
                      return (
                        <td key={label}>
                          {dispatch?.status === "sent_beta" ? (
                            <span
                              className="accountability-sent"
                              title={
                                dispatch.sent_at
                                  ? new Date(dispatch.sent_at).toLocaleString(
                                      "pt-BR",
                                      { timeZone: "America/Sao_Paulo" },
                                    )
                                  : ""
                              }
                            >
                              <Check size={14} /> Enviado BETA
                            </span>
                          ) : dispatch?.status === "processing" ? (
                            <span>Processando…</span>
                          ) : dispatch?.status === "uncertain" ? (
                            <span className="accountability-error">
                              Conferir envio
                            </span>
                          ) : (
                            <>
                              {dispatch?.status === "historical" ? (
                                <span className="accountability-history">
                                  <Check size={14} /> Enviado
                                </span>
                              ) : null}
                              {eligible ? (
                                <button
                                  className="accountability-send"
                                  disabled={!data.configured || busy}
                                  onClick={() =>
                                    setSelected({ enterprise, month })
                                  }
                                  title={
                                    dispatch?.error ||
                                    `Gerar book e Excel de ${enterprise.name} — ${label}/${year} e enviar para Rosângela`
                                  }
                                >
                                  <Send size={13} />
                                  {dispatch?.status === "historical"
                                    ? "Testar BETA"
                                    : dispatch?.status === "failed"
                                      ? "Tentar novamente"
                                      : "Gerar e enviar"}
                                </button>
                              ) : dispatch?.status !== "historical" ? (
                                <span className="accountability-muted">—</span>
                              ) : null}
                              {dispatch?.status === "failed" ? (
                                <small className="accountability-error">
                                  Falha na geração ou envio
                                </small>
                              ) : null}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {enterprises.length === 0 ? (
            <p>Nenhum empreendimento encontrado.</p>
          ) : null}
          <p className="accountability-note">
            “Enviado” em janeiro a setembro de 2026 registra o histórico
            informado. “Enviado BETA” confirma a aceitação pelo provedor de
            e-mail. O teste BETA não envia aos destinatários dos
            empreendimentos.
          </p>
        </>
      ) : null}
      <Dialog
        open={Boolean(selected)}
        onClose={() => {
          if (!busy) setSelected(null);
        }}
        title="Gerar e enviar book BETA"
        description={
          selected
            ? `${selected.enterprise.name} · ${months[selected.month - 1]}/${year}`
            : ""
        }
      >
        <p>
          O sistema reúne os PDFs originais com capa e contracapa e anexa o
          Excel de detalhamento a receber.
        </p>
        <p>
          <strong>Destinatário: {BETA_RECIPIENT}</strong>
        </p>
        <p>Os dados financeiros do Qlik serão preservados.</p>
        <Button loading={busy} onClick={() => void send()}>
          <Send size={16} /> Gerar e enviar para Rosângela
        </Button>
      </Dialog>
    </div>
  );
}
