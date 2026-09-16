"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  FileCheck2,
  MessageSquare,
  RefreshCw,
  Upload,
} from "lucide-react";
import { Button, Field } from "./ui";
import { paymentFetch, uploadPaymentFile } from "@/lib/payment-client";
import {
  CLOSED_PAYMENT_STATUSES,
  PAYMENT_FILE_TYPES,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  PAYMENT_TYPES,
  paymentMoney,
  paymentProtocol,
  type PaymentEvent,
  type PaymentFile,
  type PaymentRequest,
  type PaymentStatus,
} from "@/lib/payment-requests";

type EmailState = {
  id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
};
type Detail = {
  request: PaymentRequest;
  events: PaymentEvent[];
  files: PaymentFile[];
  emails: EmailState[];
  can_manage: boolean;
};
const labels: Record<string, string> = {
  scope: "Escopo do serviço",
  service_date: "Data do serviço",
  document_type: "Tipo de documento",
  delivery_address: "Endereço de entrega",
  cancellation_date: "Data do cancelamento",
  reason: "Motivo do distrato",
  construction_delay: "Atraso da obra",
  customer_name: "Cliente",
  contract: "Contrato",
  lot: "Lote",
  block: "Quadra",
  lawsuit: "Processo judicial",
  iptu_responsibility: "Responsabilidade pelo IPTU",
  restitution: "Restituição",
  iptu: "IPTU",
  legal_fees: "Honorários advocatícios",
  court_costs: "Custas processuais",
  damages: "Danos morais / materiais",
  issuer: "Emissor / credor",
  reference: "Referência / competência",
  barcode: "Linha digitável / código de barras",
};
const dateBr = (value: string) =>
  new Date(
    value.length === 10 ? `${value}T12:00:00` : value,
  ).toLocaleDateString("pt-BR");

export function PaymentDetail({
  id,
  trackingToken,
}: {
  id?: string;
  trackingToken?: string;
}) {
  const [data, setData] = useState<Detail | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [status, setStatus] = useState<PaymentStatus | "">(""),
    [scheduledDate, setScheduledDate] = useState("");
  const [fileKind, setFileKind] = useState<"support" | "quote" | "receipt">(
      "support",
    ),
    [files, setFiles] = useState<File[]>([]),
    [fileKey, setFileKey] = useState(0);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await paymentFetch(
          `/api/payments/${id || "tracking"}`,
          {},
          trackingToken,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Solicitação indisponível.");
    } finally {
      setLoading(false);
    }
  }, [id, trackingToken]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  async function action(kind: "status" | "reply" | "request_info") {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await paymentFetch(
        `/api/payments/${data.request.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action: kind,
            version: data.request.version,
            status: status || undefined,
            message,
            scheduled_date: scheduledDate || null,
          }),
        },
        trackingToken,
      );
      setMessage("");
      setStatus("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível atualizar.");
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!data) return;
    setBusy(true);
    setError("");
    const pending: File[] = [];
    try {
      for (const file of files) {
        try {
          await uploadPaymentFile(
            data.request.id,
            file,
            fileKind,
            trackingToken,
          );
        } catch (e) {
          pending.push(file);
          setError(e instanceof Error ? e.message : "Falha no anexo.");
        }
      }
      setFiles(pending);
      if (!pending.length) setFileKey((key) => key + 1);
      await load();
    } finally {
      setBusy(false);
    }
  }
  if (loading && !data)
    return <p className="payment-loading">Carregando solicitação…</p>;
  if (!data)
    return (
      <div className="payment-alert" role="alert">
        {error || "Solicitação não encontrada."}
        <Button onClick={() => void load()} variant="secondary">
          Tentar novamente
        </Button>
      </div>
    );
  const r = data.request,
    closed = CLOSED_PAYMENT_STATUSES.includes(r.status),
    transitions = PAYMENT_TRANSITIONS[r.status];
  return (
    <>
      {!trackingToken && (
        <Link className="payment-back" href="/pagamentos">
          <ArrowLeft size={16} />
          Solicitações de pagamento
        </Link>
      )}
      <header className="payment-detail-head">
        <div>
          <span className="eyebrow">
            {paymentProtocol(r.protocol)} · {PAYMENT_TYPES[r.type]}
          </span>
          <h1>{r.title}</h1>
          <p>{r.company_name}</p>
        </div>
        <span className={`payment-status payment-status-${r.status}`}>
          {PAYMENT_STATUSES[r.status]}
        </span>
      </header>
      {error && (
        <div role="alert" className="payment-alert">
          {error}
        </div>
      )}
      <div className="payment-detail-grid">
        <main className="payment-detail-main">
          <section className="payment-section">
            <div className="payment-money-row">
              <div>
                <span>Valor solicitado</span>
                <strong>{paymentMoney(r.amount)}</strong>
              </div>
              <div>
                <span>Orçamento máximo</span>
                <strong>
                  {r.budget_max === null
                    ? "Não informado"
                    : paymentMoney(r.budget_max)}
                </strong>
              </div>
            </div>
            {r.budget_max !== null && r.amount > r.budget_max && (
              <p className="payment-alert">
                O valor solicitado supera o orçamento máximo informado.
              </p>
            )}
            <dl className="payment-facts">
              <div>
                <dt>Solicitante</dt>
                <dd>
                  {r.requester_name}
                  <br />
                  {r.requester_email}
                  {r.requester_phone && (
                    <>
                      <br />
                      {r.requester_phone}
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Obra / empreendimento</dt>
                <dd>{r.project_name || "Não informado"}</dd>
              </div>
              <div>
                <dt>Data desejada</dt>
                <dd>{dateBr(r.due_date)}</dd>
              </div>
              <div>
                <dt>Recebida em</dt>
                <dd>
                  {dateBr(r.created_at)} ·{" "}
                  {r.source === "public"
                    ? "Link público"
                    : r.source === "internal"
                      ? "Sistema interno"
                      : r.source}
                </dd>
              </div>
              {r.scheduled_date && (
                <div>
                  <dt>Pagamento agendado</dt>
                  <dd>{dateBr(r.scheduled_date)}</dd>
                </div>
              )}
              {r.paid_at && (
                <div>
                  <dt>Pagamento registrado</dt>
                  <dd>{dateBr(r.paid_at)}</dd>
                </div>
              )}
              {r.finalized_at && (
                <div>
                  <dt>Finalizado em</dt>
                  <dd>{dateBr(r.finalized_at)}</dd>
                </div>
              )}
            </dl>
            <h3>Descrição e características</h3>
            <p className="payment-preline">{r.description}</p>
          </section>
          <section className="payment-section">
            <h2>{PAYMENT_TYPES[r.type]}</h2>
            <dl className="payment-facts">
              {Object.entries(r.details)
                .filter(([key]) => key !== "type" && key !== "items")
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{labels[key] || key}</dt>
                    <dd className="payment-preline">
                      {typeof value === "number"
                        ? paymentMoney(value)
                        : typeof value === "boolean"
                          ? value
                            ? "Sim"
                            : "Não"
                          : key.endsWith("_date")
                            ? dateBr(String(value))
                            : key === "iptu_responsibility"
                              ? {
                                  company: "Empresa",
                                  customer: "Cliente",
                                  not_applicable: "Não se aplica",
                                }[String(value)] || "—"
                              : String(value || "Não informado")}
                    </dd>
                  </div>
                ))}
            </dl>
            {r.details.type === "materials" && (
              <div className="payment-table-scroll">
                <table className="payment-table">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Quantidade</th>
                      <th>Preço unitário</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.details.items.map((item, i) => (
                      <tr key={i}>
                        <td>{item.description}</td>
                        <td>
                          {item.quantity} {item.unit}
                        </td>
                        <td>{paymentMoney(item.unit_price)}</td>
                        <td>
                          {paymentMoney(
                            Math.round(item.quantity * item.unit_price * 100) /
                              100,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="payment-section">
            <h2>Beneficiário</h2>
            <dl className="payment-facts">
              <div>
                <dt>
                  {r.beneficiary.person_type === "PF"
                    ? "Pessoa física"
                    : "Pessoa jurídica"}
                </dt>
                <dd>
                  {r.beneficiary.name}
                  <br />
                  {r.beneficiary.tax_id}
                </dd>
              </div>
              <div>
                <dt>Forma de pagamento</dt>
                <dd>
                  {
                    {
                      pix: "PIX",
                      transfer: "Transferência / depósito",
                      boleto: "Boleto",
                      guide: "Guia / DARF",
                      other: "Outros",
                    }[r.beneficiary.method]
                  }
                </dd>
              </div>
              {Object.entries({
                email: "E-mail",
                phone: "Telefone",
                pix_key: "Chave PIX",
                bank: "Banco",
                branch: "Agência",
                account: "Conta",
                account_holder: "Titular",
              }).map(([key, label]) => {
                const value = r.beneficiary[key as keyof typeof r.beneficiary];
                return value ? (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ) : null;
              })}
            </dl>
          </section>
          <section className="payment-section">
            <h2>Orçamentos recebidos</h2>
            {r.quotes.length ? (
              r.quotes.map((quote, i) => (
                <div className="payment-quote-summary" key={i}>
                  <strong>{quote.supplier}</strong>
                  <span>{paymentMoney(quote.amount)}</span>
                  <p>{quote.notes}</p>
                </div>
              ))
            ) : (
              <p>Nenhum orçamento informado.</p>
            )}
          </section>
          <section className="payment-section">
            <h2>
              <FileCheck2 size={20} />
              Documentos e comprovantes
            </h2>
            {data.files.length ? (
              <ul className="payment-file-list">
                {data.files.map((file) => (
                  <li key={file.id}>
                    <div>
                      <strong>{file.name}</strong>
                      <small>
                        {
                          {
                            support: "Documento de apoio",
                            quote: "Orçamento",
                            receipt: "Comprovante de pagamento",
                          }[file.kind]
                        }{" "}
                        · {(file.size / 1024).toFixed(0)} KB
                      </small>
                    </div>
                    <Button
                      variant="ghost"
                      aria-label={`Baixar ${file.name}`}
                      onClick={async () => {
                        try {
                          const result = await paymentFetch(
                            `/api/payments/${r.id}/files/${file.id}`,
                            {},
                            trackingToken,
                          );
                          const link = document.createElement("a");
                          link.href = result.url;
                          link.rel = "noopener noreferrer";
                          link.target = "_blank";
                          link.click();
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : "Falha ao baixar.",
                          );
                        }
                      }}
                    >
                      <Download size={17} />
                      Baixar
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Nenhum documento anexado.</p>
            )}
            {!closed && (
              <div className="payment-upload">
                <Field label="Tipo do anexo">
                  <select
                    value={fileKind}
                    disabled={busy}
                    onChange={(e) =>
                      setFileKind(e.target.value as typeof fileKind)
                    }
                  >
                    <option value="support">Documento de apoio</option>
                    <option value="quote">Orçamento</option>
                    {data.can_manage && (
                      <option value="receipt">Comprovante de pagamento</option>
                    )}
                  </select>
                </Field>
                <Field
                  label="Selecionar arquivos"
                  hint="PDF, imagens, Word ou Excel. Até 10 MB por arquivo."
                >
                  <input
                    key={fileKey}
                    type="file"
                    multiple
                    disabled={busy}
                    accept={PAYMENT_FILE_TYPES.join(",")}
                    onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  />
                </Field>
                <Button
                  variant="secondary"
                  loading={busy}
                  disabled={busy || !files.length}
                  onClick={() => void upload()}
                >
                  <Upload size={16} />
                  Anexar {files.length || ""}
                </Button>
              </div>
            )}
          </section>
        </main>
        <aside className="payment-detail-aside">
          {(!closed || (data.can_manage && transitions.length > 0)) && (
            <section className="payment-section">
              <h2>
                {data.can_manage ? "Gestão do pagamento" : "Enviar informações"}
              </h2>
              {r.status === "awaiting_information" && (
                <p className="payment-alert">
                  A equipe precisa de informações adicionais. Consulte o
                  histórico abaixo e responda aqui.
                </p>
              )}
              <Field
                label={
                  data.can_manage ? "Mensagem ao solicitante" : "Sua resposta"
                }
              >
                <textarea
                  rows={4}
                  value={message}
                  maxLength={5000}
                  disabled={busy}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={
                    data.can_manage
                      ? "Explique a atualização ou a informação necessária."
                      : "Escreva as informações solicitadas."
                  }
                />
              </Field>
              {!closed && (
                <Button
                  variant="secondary"
                  disabled={busy || !message.trim()}
                  onClick={() => void action("reply")}
                >
                  <MessageSquare size={16} />
                  {data.can_manage ? "Enviar mensagem" : "Enviar resposta"}
                </Button>
              )}
              {data.can_manage && (
                <>
                  <hr />
                  <Field label="Próximo status">
                    <select
                      value={status}
                      disabled={busy}
                      onChange={(e) =>
                        setStatus(e.target.value as PaymentStatus | "")
                      }
                    >
                      <option value="">Selecione a atualização</option>
                      {transitions.map((s) => (
                        <option key={s} value={s}>
                          {PAYMENT_STATUSES[s]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {status === "scheduled" && (
                    <Field label="Data de pagamento *">
                      <input
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        disabled={busy}
                      />
                    </Field>
                  )}
                  {status === "paid" &&
                    !data.files.some((f) => f.kind === "receipt") && (
                      <p className="payment-alert">
                        Anexe um comprovante na seção Documentos antes de
                        concluir o pagamento.
                      </p>
                    )}
                  <Button
                    disabled={
                      busy ||
                      !status ||
                      (status === "paid" &&
                        !data.files.some((f) => f.kind === "receipt"))
                    }
                    loading={busy}
                    onClick={() => void action("status")}
                  >
                    Atualizar status
                  </Button>
                  {transitions.includes("awaiting_information") && (
                    <Button
                      variant="ghost"
                      disabled={busy || !message.trim()}
                      onClick={() => void action("request_info")}
                    >
                      Solicitar novas informações
                    </Button>
                  )}
                </>
              )}
            </section>
          )}
          <section className="payment-section">
            <div className="payment-history-head">
              <h2>Histórico</h2>
              <Button
                variant="ghost"
                aria-label="Atualizar histórico"
                disabled={busy || loading}
                onClick={() => void load()}
              >
                <RefreshCw size={16} />
              </Button>
            </div>
            <ol className="payment-timeline">
              {[...data.events].reverse().map((event) => (
                <li key={event.id}>
                  <strong>{PAYMENT_STATUSES[event.status]}</strong>
                  <p className="payment-preline">
                    {event.message || "Status atualizado."}
                  </p>
                  <small>
                    {event.actor_name} ·{" "}
                    {new Date(event.created_at).toLocaleString("pt-BR")}
                  </small>
                </li>
              ))}
            </ol>
          </section>
          {data.can_manage && (
            <section className="payment-section">
              <h2>Notificações por e-mail</h2>
              {data.emails.map((email) => (
                <div className="payment-email-state" key={email.id}>
                  <strong>
                    {
                      {
                        sent: "Enviado ao provedor",
                        pending: "Na fila",
                        sending: "Enviando",
                        failed: "Falha no envio",
                      }[email.status]
                    }
                  </strong>
                  <small>
                    {new Date(email.created_at).toLocaleString("pt-BR")}
                    {email.attempts > 0 && ` · ${email.attempts} tentativa(s)`}
                  </small>
                  {email.last_error && <p>{email.last_error}</p>}
                </div>
              ))}
              {data.emails.some((email) => email.status === "failed") && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await paymentFetch(
                        `/api/payments/${r.id}/retry-emails`,
                        { method: "POST" },
                      );
                      if (!result.configured)
                        throw new Error(
                          "O envio de e-mail precisa ser configurado pela administração.",
                        );
                      await load();
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Falha ao reenviar.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Tentar e-mails novamente
                </Button>
              )}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
