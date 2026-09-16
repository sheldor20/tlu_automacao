"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Plus, Trash2, Send } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { getSupabase } from "@/lib/supabase";
import {
  PAYMENT_TYPES,
  PAYMENT_FILE_TYPES,
  detailsTotal,
  terminationTotal,
  paymentCreateSchema,
  paymentMoney,
  paymentProtocol,
  type PaymentDetails,
  type PaymentType,
} from "@/lib/payment-requests";
import { paymentFetch, uploadPaymentFile } from "@/lib/payment-client";

type Company = { company_key: string; name: string };
type Created = { id: string; protocol: number; token: string };
export function PaymentRequestForm({
  publicForm = false,
}: {
  publicForm?: boolean;
}) {
  const [type, setType] = useState<PaymentType>("service");
  const [companies, setCompanies] = useState<Company[]>([]),
    [companyDate, setCompanyDate] = useState("");
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [personType, setPersonType] = useState("PF"),
    [requiredMethod, setRequiredMethod] = useState("pix"),
    [materialsMethod, setMaterialsMethod] = useState("");
  const materials = type === "materials";
  const method = materials ? materialsMethod : requiredMethod;
  const [identity, setIdentity] = useState({ name: "", email: "" });
  const [submissionId, setSubmissionId] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Array<{
    id: number; description: string; quantity: number; unit: string; unit_price: number | null;
  }>>([
    { id: 1, description: "", quantity: 1, unit: "un", unit_price: null },
  ]);
  const [quotes, setQuotes] = useState<
    Array<{ id: number; supplier: string; amount: number; notes: string }>
  >([]);
  const [terminationAmounts, setTerminationAmounts] = useState({
    restitution: 0,
    iptu: 0,
    legal_fees: 0,
    court_costs: 0,
    damages: 0,
  });
  const [iptuResponsibility, setIptuResponsibility] = useState<"company" | "customer" | "">("");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await paymentFetch("/api/payments/companies");
        if (!active) return;
        setCompanies(data.companies);
        setCompanyDate(data.synchronized_at || "");
        setSubmissionId(crypto.randomUUID());
        if (!publicForm) {
          const session = await getSupabase()?.auth.getSession();
          if (session?.data.session) {
            const profile = await getSupabase()!
              .from("profiles")
              .select("full_name")
              .eq("user_id", session.data.session.user.id)
              .single();
            if (active)
              setIdentity({
                name: profile.data?.full_name || "",
                email: session.data.session.user.email || "",
              });
          }
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Não foi possível carregar as empresas.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [publicForm]);
  const total =
    type === "materials"
      ? detailsTotal({ type: "materials", items, delivery_address: "" })
      : type === "termination"
        ? iptuResponsibility
          ? terminationTotal({ ...terminationAmounts, iptu_responsibility: iptuResponsibility })
          : null
        : null;

  async function sendFiles(result: Created) {
    const pending: File[] = [],
      errors: string[] = [];
    for (const file of files) {
      try {
        await uploadPaymentFile(
          result.id,
          file,
          "support",
          publicForm ? result.token : undefined,
        );
      } catch (e) {
        pending.push(file);
        errors.push(e instanceof Error ? e.message : file.name);
      }
    }
    setFiles(pending);
    setError(errors.join(" "));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const values = new FormData(event.currentTarget);
    const s = (name: string) => String(values.get(name) || "").trim();
    const n = (name: string) => Number(s(name) || 0);
    try {
      const details: PaymentDetails =
        type === "service"
          ? {
              type,
              scope: s("scope"),
              service_date: s("service_date"),
              document_type: s("document_type"),
            }
          : type === "materials"
            ? {
                type,
                delivery_address: s("delivery_address"),
                items: items.map(
                  ({ description, quantity, unit, unit_price }) => ({
                    description,
                    quantity,
                    unit,
                    unit_price,
                  }),
                ),
              }
            : type === "termination"
              ? {
                  type,
                  cancellation_date: s("cancellation_date"),
                  reason: s("reason"),
                  construction_delay: s("construction_delay") === "yes",
                  customer_name: s("customer_name"),
                  contract: s("contract"),
                  lot: s("lot"),
                  block: s("block"),
                  lawsuit: s("lawsuit"),
                  iptu_responsibility: s("iptu_responsibility") as
                    "company" | "customer",
                  document_type: s("document_type"),
                  ...terminationAmounts,
                }
              : {
                  type,
                  issuer: s("issuer"),
                  document_type: s("document_type"),
                  reference: s("reference"),
                  barcode: s("barcode"),
                };
      const input = paymentCreateSchema.safeParse({
        submission_id: submissionId,
        requester_name: s("requester_name"),
        requester_email: s("requester_email"),
        requester_phone: s("requester_phone"),
        company_key: s("company_key"),
        project_name: s("project_name"),
        title: s("title"),
        description: s("description"),
        amount: type === "materials" || type === "termination"
          ? detailsTotal(details) : n("amount"),
        budget_max: s("budget_max") ? n("budget_max") : null,
        due_date: s("due_date"),
        details,
        beneficiary: {
          person_type: personType,
          name: s("beneficiary_name"),
          tax_id: s("tax_id"),
          email: s("beneficiary_email"),
          phone: s("beneficiary_phone"),
          method,
          pix_key: s("pix_key"),
          bank: s("bank"),
          branch: s("branch"),
          account: s("account"),
          account_holder: s("account_holder"),
        },
        quotes: quotes.map(({ supplier, amount, notes }) => ({
          supplier,
          amount,
          notes,
        })),
        website: s("website"),
      });
      if (!input.success)
        throw new Error(input.error.issues.map((i) => i.message).join(" "));
      const result = await paymentFetch("/api/payments", {
        method: "POST",
        body: JSON.stringify(input.data),
        anonymous: publicForm,
      });
      setCreated(result);
      await sendFiles(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar.");
    } finally {
      setSaving(false);
    }
  }
  if (created)
    return (
      <section className="payment-success panel">
        <CheckCircle2 size={40} />
        <h2>Solicitação recebida</h2>
        <p className="payment-protocol">{paymentProtocol(created.protocol)}</p>
        <p>
          Guarde seu link de acompanhamento. As atualizações também serão
          enviadas por e-mail.
        </p>
        {saving ? (
          <p role="status">
            Enviando anexos. Aguarde a conclusão para sair desta página…
          </p>
        ) : error ? (
          <div className="payment-alert" role="alert">
            <p>
              A solicitação foi salva. Alguns anexos ainda precisam ser
              enviados.
            </p>
            <p>{error}</p>
            <Button
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await sendFiles(created);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Tentar anexos novamente
            </Button>
          </div>
        ) : (
          <p>Dados e anexos enviados.</p>
        )}
        {saving ? (
          <Button disabled loading>
            Aguarde o envio
          </Button>
        ) : (
          <Link
            className="button button-primary"
            href={
              publicForm
                ? `/acompanhar-pagamento#${created.token}`
                : `/pagamentos/${created.id}`
            }
          >
            Acompanhar solicitação
          </Link>
        )}
        {!saving && (
          <p>
            <Link
              href={publicForm ? "/solicitar-pagamento" : "/pagamentos"}
              onClick={() => {
                setCreated(null);
                setSubmissionId(crypto.randomUUID());
              }}
            >
              Voltar
            </Link>
          </p>
        )}
      </section>
    );
  if (loading)
    return <p className="payment-loading">Carregando empresas do Qlik…</p>;
  return (
    <form className="payment-form" onSubmit={submit}>
      <fieldset className="payment-type-picker" disabled={saving}>
        <legend>O que você precisa solicitar?</legend>
        <div>
          {Object.entries(PAYMENT_TYPES).map(([key, label]) => (
            <label className={type === key ? "selected" : ""} key={key}>
              <input
                type="radio"
                name="request_type"
                value={key}
                checked={type === key}
                onChange={() => setType(key as PaymentType)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="payment-section" disabled={saving}>
        <legend>1. Solicitação e empresa</legend>
        <div className="form-grid">
          <Field label="Seu nome *">
            <input
              name="requester_name"
              value={identity.name}
              onChange={(e) =>
                setIdentity({ ...identity, name: e.target.value })
              }
              readOnly={!publicForm}
              required
              maxLength={200}
              autoComplete="name"
            />
          </Field>
          <Field
            label="Seu e-mail *"
            hint="Você receberá as atualizações neste endereço."
          >
            <input
              name="requester_email"
              type="email"
              value={identity.email}
              onChange={(e) =>
                setIdentity({ ...identity, email: e.target.value })
              }
              readOnly={!publicForm}
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Telefone">
            <input
              name="requester_phone"
              type="tel"
              maxLength={40}
              autoComplete="tel"
            />
          </Field>
          <Field
            label="Empresa *"
            hint={
              companyDate
                ? `Lista do Qlik atualizada em ${new Date(companyDate).toLocaleDateString("pt-BR")}.`
                : undefined
            }
          >
            <select name="company_key" required defaultValue="">
              <option value="">Selecione a empresa</option>
              {companies.map((c) => (
                <option key={c.company_key} value={c.company_key}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Obra / empreendimento">
            <input name="project_name" maxLength={300} />
          </Field>
          <Field label="Data desejada de pagamento *">
            <input name="due_date" type="date" required />
          </Field>
          <Field label="Título da solicitação *" className="form-span-2">
            <input
              name="title"
              required
              maxLength={180}
              placeholder="Ex.: Pagamento de serviço de manutenção"
            />
          </Field>
          <Field
            label="Descrição, características e justificativa *"
            className="form-span-2"
          >
            <textarea name="description" required maxLength={8000} rows={4} />
          </Field>
          {type === "service" || type === "bills" ? (
            <Field label="Valor solicitado (R$) *">
              <input
                name="amount"
                type="number"
                min="0.01"
                max="999999999.99"
                step="0.01"
                required
              />
            </Field>
          ) : (
            <div className="payment-total">
              <span>{type === "termination" ? "Valor a pagar" : "Valor calculado"}</span>
              <strong>{paymentMoney(total)}</strong>
              {type === "termination" && <small>
                Restituição menos honorários, custas e danos. IPTU descontado somente quando a responsabilidade é da empresa/Terra Lotus.
              </small>}
            </div>
          )}
          <Field
            label="Orçamento máximo (R$)"
            hint="Deixe em branco quando ainda não houver um limite definido."
          >
            <input
              name="budget_max"
              type="number"
              min="0"
              max="999999999.99"
              step="0.01"
            />
          </Field>
        </div>
      </fieldset>
      <fieldset className="payment-section" disabled={saving}>
        <legend>2. Dados de {PAYMENT_TYPES[type].toLowerCase()}</legend>
        <div className="form-grid">
          {type === "service" && (
            <>
              <Field
                label="Serviço a executar / executado *"
                className="form-span-2"
              >
                <textarea name="scope" required rows={3} maxLength={5000} />
              </Field>
              <Field label="Data do serviço *">
                <input name="service_date" type="date" required />
              </Field>
            </>
          )}
          {type === "materials" && (
            <>
              <Field
                label="Local e endereço de entrega *"
                className="form-span-2"
              >
                <textarea
                  name="delivery_address"
                  required
                  maxLength={1000}
                  rows={2}
                />
              </Field>
              <div className="form-span-2 payment-items">
                {items.map((item, index) => (
                  <div key={item.id} className="payment-item-row">
                    <Field label={`Material ${index + 1} *`}>
                      <input
                        required
                        value={item.description}
                        maxLength={500}
                        onChange={(e) =>
                          setItems(
                            items.map((x) =>
                              x.id === item.id
                                ? { ...x, description: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Quantidade *">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        required
                        value={item.quantity}
                        onChange={(e) =>
                          setItems(
                            items.map((x) =>
                              x.id === item.id
                                ? { ...x, quantity: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Unidade *">
                      <input
                        required
                        maxLength={30}
                        value={item.unit}
                        onChange={(e) =>
                          setItems(
                            items.map((x) =>
                              x.id === item.id
                                ? { ...x, unit: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Preço unitário (R$)" hint="Opcional. Preencha quando souber.">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price ?? ""}
                        placeholder="A definir"
                        onChange={(e) =>
                          setItems(
                            items.map((x) =>
                              x.id === item.id
                                ? { ...x, unit_price: e.target.value === "" ? null : Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Button
                      variant="ghost"
                      type="button"
                      aria-label={`Remover material ${index + 1}`}
                      disabled={items.length === 1}
                      onClick={() =>
                        setItems(items.filter((x) => x.id !== item.id))
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={items.length >= 100}
                  onClick={() =>
                    setItems([
                      ...items,
                      {
                        id: Date.now(),
                        description: "",
                        quantity: 1,
                        unit: "un",
                        unit_price: null,
                      },
                    ])
                  }
                >
                  <Plus size={16} />
                  Adicionar material
                </Button>
              </div>
            </>
          )}
          {type === "termination" && (
            <>
              <Field label="Data do cancelamento *">
                <input name="cancellation_date" type="date" required />
              </Field>
              <Field label="Motivado por atraso da obra? *">
                <select name="construction_delay" required defaultValue="">
                  <option value="">Selecione</option>
                  <option value="yes">Sim</option>
                  <option value="no">Não</option>
                </select>
              </Field>
              <Field label="Motivo do distrato *" className="form-span-2">
                <textarea name="reason" required rows={2} maxLength={1000} />
              </Field>
              <Field label="Nome do cliente *">
                <input name="customer_name" required maxLength={200} />
              </Field>
              <Field label="Contrato">
                <input name="contract" maxLength={200} />
              </Field>
              <Field label="Lote">
                <input name="lot" maxLength={100} />
              </Field>
              <Field label="Quadra">
                <input name="block" maxLength={100} />
              </Field>
              <Field label="Número do processo judicial">
                <input name="lawsuit" maxLength={200} />
              </Field>
              <Field label="Responsabilidade pelo IPTU *">
                <select name="iptu_responsibility" required value={iptuResponsibility}
                  onChange={(e) => setIptuResponsibility(e.target.value as typeof iptuResponsibility)}>
                  <option value="">Selecione</option>
                  <option value="company">Empresa / Terra Lotus</option>
                  <option value="customer">Cliente</option>
                </select>
              </Field>
              {Object.entries({
                restitution: "Restituição",
                iptu: "IPTU",
                legal_fees: "Honorários advocatícios",
                court_costs: "Custas processuais",
                damages: "Danos morais / materiais",
              }).map(([key, label]) => (
                <Field key={key} label={`${label} (R$) *`}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={
                      terminationAmounts[key as keyof typeof terminationAmounts]
                    }
                    onChange={(e) =>
                      setTerminationAmounts({
                        ...terminationAmounts,
                        [key]: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              ))}
            </>
          )}
          {type === "bills" && (
            <>
              <Field label="Emissor / credor *">
                <input name="issuer" required maxLength={200} />
              </Field>
              <Field label="Referência / competência *">
                <input
                  name="reference"
                  required
                  maxLength={200}
                  placeholder="Ex.: Energia — setembro/2026"
                />
              </Field>
              <Field
                label="Linha digitável / código de barras"
                className="form-span-2"
              >
                <input name="barcode" maxLength={100} inputMode="numeric" />
              </Field>
            </>
          )}
          {type !== "materials" && (
            <Field label="Tipo do documento *">
              <select name="document_type" required defaultValue="">
                <option value="">Selecione</option>
                {[
                  "Nota fiscal",
                  "RPA",
                  "Recibo",
                  "Boleto",
                  "Guia",
                  "DARF",
                  "Contrato / distrato",
                  "Outros",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </fieldset>
      <fieldset className="payment-section" disabled={saving}>
        <legend>3. Beneficiário e forma de pagamento</legend>
        {materials && <p>Dados opcionais. Preencha se já souber quem receberá e como será o pagamento.</p>}
        <div className="form-grid">
          <Field label={`Pessoa física ou jurídica${materials ? "" : " *"}`}>
            <select
              value={personType}
              onChange={(e) => setPersonType(e.target.value)}
            >
              <option value="PF">Pessoa física (PF)</option>
              <option value="PJ">Pessoa jurídica (PJ)</option>
            </select>
          </Field>
          <Field
            label={
              (personType === "PF" ? "Nome completo do beneficiário" : "Razão social") +
              (materials ? "" : " *")
            }
          >
            <input name="beneficiary_name" required={!materials} maxLength={200} />
          </Field>
          <Field label={`${personType === "PF" ? "CPF" : "CNPJ"}${materials ? "" : " *"}`}>
            <input
              name="tax_id"
              required={!materials}
              maxLength={30}
              inputMode={personType === "PF" ? "numeric" : "text"}
            />
          </Field>
          <Field label="E-mail do beneficiário">
            <input name="beneficiary_email" type="email" />
          </Field>
          <Field label="Telefone do beneficiário">
            <input name="beneficiary_phone" type="tel" maxLength={40} />
          </Field>
          <Field label={`Forma de pagamento${materials ? "" : " *"}`}>
            <select value={method} onChange={(e) =>
              materials ? setMaterialsMethod(e.target.value) : setRequiredMethod(e.target.value)
            }>
              {materials && <option value="">A definir</option>}
              <option value="pix">PIX</option>
              <option value="transfer">Transferência / depósito</option>
              <option value="boleto">Boleto</option>
              <option value="guide">Guia / DARF</option>
              <option value="other">Outros</option>
            </select>
          </Field>
          {method === "pix" && (
            <Field label="Chave PIX *" className="form-span-2">
              <input name="pix_key" required maxLength={200} />
            </Field>
          )}
          {method === "transfer" && (
            <>
              <Field label="Banco *">
                <input name="bank" required maxLength={100} />
              </Field>
              <Field label="Agência e dígito *">
                <input name="branch" required maxLength={30} />
              </Field>
              <Field label="Conta e dígito *">
                <input name="account" required maxLength={50} />
              </Field>
              <Field label="Titular da conta *">
                <input name="account_holder" required maxLength={200} />
              </Field>
            </>
          )}
        </div>
      </fieldset>
      <fieldset className="payment-section" disabled={saving}>
        <legend>4. Orçamentos e documentos</legend>
        <p>
          Cadastre os orçamentos que já recebeu e anexe notas, boletos,
          propostas ou documentos que expliquem o pedido.
        </p>
        {quotes.map((quote, index) => (
          <div className="payment-quote-row" key={quote.id}>
            <Field label={`Fornecedor ${index + 1} *`}>
              <input
                required
                maxLength={200}
                value={quote.supplier}
                onChange={(e) =>
                  setQuotes(
                    quotes.map((q) =>
                      q.id === quote.id
                        ? { ...q, supplier: e.target.value }
                        : q,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Valor orçado (R$) *">
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={quote.amount}
                onChange={(e) =>
                  setQuotes(
                    quotes.map((q) =>
                      q.id === quote.id
                        ? { ...q, amount: Number(e.target.value) }
                        : q,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Condições / observações">
              <input
                maxLength={2000}
                value={quote.notes}
                onChange={(e) =>
                  setQuotes(
                    quotes.map((q) =>
                      q.id === quote.id ? { ...q, notes: e.target.value } : q,
                    ),
                  )
                }
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Remover orçamento ${index + 1}`}
              onClick={() => setQuotes(quotes.filter((q) => q.id !== quote.id))}
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={quotes.length >= 20}
          onClick={() =>
            setQuotes([
              ...quotes,
              { id: Date.now(), supplier: "", amount: 0, notes: "" },
            ])
          }
        >
          <Plus size={16} />
          Adicionar orçamento
        </Button>
        <Field
          label="Anexos"
          hint="PDF, JPG, PNG, WebP, Word ou Excel. Até 10 MB por arquivo."
        >
          <input
            type="file"
            accept={PAYMENT_FILE_TYPES.join(",")}
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
        </Field>
        {files.length > 0 && <p>{files.length} arquivo(s) selecionado(s).</p>}
      </fieldset>
      <div className="payment-honeypot" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {error && (
        <div className="payment-alert" role="alert">
          {error}
        </div>
      )}
      {!companies.length && (
        <div className="payment-alert" role="alert">
          A lista de empresas não está disponível. Recarregue a página ou avise
          a administração.
        </div>
      )}
      <div className="payment-form-footer">
        <p>
          Confira os dados do beneficiário antes de enviar. A solicitação será
          analisada pela equipe responsável.
        </p>
        <Button
          type="submit"
          loading={saving}
          disabled={saving || !companies.length || !submissionId}
        >
          <Send size={16} />
          Enviar solicitação
        </Button>
      </div>
    </form>
  );
}
