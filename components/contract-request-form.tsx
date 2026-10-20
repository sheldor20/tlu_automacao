"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { CONTRACT_TYPES, contractCreateSchema, contractDetailsSchema, contractProtocol, type ContractDetails, type ContractRequest, type ContractType } from "@/lib/contract-requests";
import { contractFetch } from "@/lib/contract-client";
import { Button, Field } from "./ui";

export function ContractRequestForm({ publicForm = false, identity, initialRequest, token, onSaved, onCancel }: {
  publicForm?: boolean; identity?: { name: string; email: string }; initialRequest?: ContractRequest; token?: string; onSaved?: () => void; onCancel?: () => void;
}) {
  const [type, setType] = useState<ContractType>(initialRequest?.details.type || "rental");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; protocol: number; token?: string } | null>(null);
  const submission = useRef<{ id: string; token: string } | null>(null);
  const d = initialRequest?.details;
  const field = (name: keyof ContractDetails, label: string, required = false, inputType = "text", hint?: string) => (
    <Field key={name} label={`${label}${required ? " *" : ""}`} hint={hint}>
      <input name={name} defaultValue={d?.[name] ?? ""} required={required} type={inputType} maxLength={inputType === "text" ? 2000 : undefined}
        step={name === "amount" ? "0.01" : inputType === "number" ? "1" : undefined} min={inputType === "number" ? (name === "amount" ? 0 : 1) : undefined}
        max={name === "due_day" ? 31 : name === "term_months" ? 1200 : name === "amount" ? 999999999.99 : undefined} />
    </Field>
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true);
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const details = contractDetailsSchema.parse({ ...data, type, amount: data.amount ? Number(data.amount) : null,
        due_day: data.due_day ? Number(data.due_day) : null, term_months: data.term_months ? Number(data.term_months) : null });
      if (initialRequest) {
        await contractFetch(`/api/contracts/${initialRequest.id}`, { method: "PATCH", body: JSON.stringify({ version: initialRequest.version, details, message: "Dados do contrato complementados." }) }, token);
        onSaved?.();
      } else {
        if (!submission.current) submission.current = { id: crypto.randomUUID(), token: Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("") };
        const body = contractCreateSchema.parse({ submission_id: submission.current.id, tracking_token: submission.current.token,
          requester_name: publicForm ? data.requester_name : identity?.name, requester_email: publicForm ? data.requester_email : identity?.email, details });
        setCreated(await contractFetch("/api/contracts", { method: "POST", body: JSON.stringify(body), anonymous: publicForm }));
      }
    } catch (e) {
      const issues = e && typeof e === "object" && "issues" in e ? (e.issues as Array<{ path: unknown[]; message: string }>) : null;
      setError(issues ? [...new Set(issues.map(i => i.message))].join(" ") : e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally { setSaving(false); }
  }
  if (created) return <section className="payment-section" role="status"><h2>Contrato solicitado</h2><p>Protocolo: <strong>{contractProtocol(created.protocol)}</strong></p>
    {created.token && <p>Guarde o link de acompanhamento para consultar o pedido e responder à gestão.</p>}
    <Link className="button button-primary" href={created.token ? `/acompanhar-contrato/${created.token}` : `/pagamentos/contratos/${created.id}`}>Acompanhar solicitação</Link>
  </section>;
  return <form className="payment-form" onSubmit={submit}>
    <fieldset className="payment-section" disabled={saving}><legend>1. Solicitação de contrato</legend><div className="form-grid">
      {!initialRequest && <><Field label="Seu nome *"><input name="requester_name" defaultValue={identity?.name} required={publicForm} readOnly={!publicForm} maxLength={200} autoComplete="name" /></Field><Field label="Seu e-mail *"><input name="requester_email" defaultValue={identity?.email} type="email" required={publicForm} readOnly={!publicForm} autoComplete="email" /></Field></>}
      <Field label="Tipo de contrato *"><select value={type} onChange={e => setType(e.target.value as ContractType)}>{Object.entries(CONTRACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      {type === "other" && field("other_type", "Qual tipo de contrato?", true)}
      {field("title", "Título da solicitação", true)}{field("company_name", "Empresa solicitante", true)}{field("deadline", "Prazo desejado para receber o contrato", false, "date")}
      {["amendment", "termination"].includes(type) && field("original_contract", "Identificação do contrato original", true)}
    </div></fieldset>
    <fieldset className="payment-section" disabled={saving}><legend>2. Partes e contato</legend><div className="form-grid">
      {field("party_a_name", type === "rental" ? "Nome / razão social do locador" : "Nome / razão social da parte A", true)}{field("party_a_tax_id", "CPF / CNPJ da parte A", true)}
      {field("party_a_address", "Endereço completo da parte A", true)}{field("party_a_qualification", "Qualificação da parte A", false, "text", "Nacionalidade, estado civil, profissão e RG, quando aplicável.")}{field("party_a_representative", "Representante da parte A", false, "text", "Nome, cargo, CPF e RG, quando aplicável.")}
      {field("party_b_name", type === "rental" ? "Nome / razão social da locatária" : "Nome / razão social da parte B", true)}{field("party_b_tax_id", "CPF / CNPJ da parte B", true)}
      {field("party_b_address", "Endereço completo da parte B", true)}{field("party_b_qualification", "Qualificação da parte B")}{field("party_b_representative", "Representante da parte B", false, "text", "Nome, cargo, CPF e RG, quando aplicável.")}
      {field("contact_email", "E-mail de contato", false, "email")}{field("contact_phone", "Telefone de contato", false, "tel")}
    </div></fieldset>
    <fieldset className="payment-section" disabled={saving}><legend>3. Objeto, valores e vigência</legend><div className="form-grid">
      <Field label="Objeto / escopo do contrato *"><textarea name="object" defaultValue={d?.object} required maxLength={4000} rows={3} /></Field>
      {field("amount", type === "rental" ? "Aluguel mensal (R$)" : "Valor do contrato (R$)", type === "rental", "number")}
      {field("start_date", "Início da vigência", type === "rental", "date")}{field("end_date", "Término da vigência", type === "rental", "date")}
      <Field label="Condições de pagamento"><textarea name="payment_terms" defaultValue={d?.payment_terms} maxLength={2000} rows={3} /></Field>
    </div></fieldset>
    {type === "rental" && <fieldset className="payment-section" disabled={saving}><legend>4. Dados da locação comercial</legend><div className="form-grid">
      {field("property_address", "Endereço completo do imóvel", true)}{field("property_registration", "Matrícula / registro do imóvel")}{field("purpose", "Finalidade comercial do imóvel")}
      {field("term_months", "Prazo em meses", true, "number")}{field("first_payment", "Data do primeiro aluguel", true, "date")}{field("due_day", "Dia de vencimento mensal", true, "number")}
      {field("grace_period", "Carência", false, "text", "Informe o período ou indique sem carência.")}{field("adjustment_index", "Índice de reajuste")}{field("renewal", "Condições de renovação")}
      {field("bank_details", "Dados bancários para pagamento", false, "text", "Banco, agência, conta, titular e CPF/CNPJ.")}{field("guarantee", "Garantia da locação")}
      {field("jurisdiction", "Foro / comarca")}{field("signature_city", "Cidade da assinatura")}{field("signature_date", "Data da assinatura", false, "date")}{field("witnesses", "Testemunhas (nomes e CPF)")}
    </div></fieldset>}
    <fieldset className="payment-section" disabled={saving}><legend>Condições e observações</legend><Field label="Informações adicionais"><textarea name="notes" defaultValue={d?.notes} rows={4} maxLength={6000} /></Field>
      <p>{type === "rental" ? "A minuta de locação será preenchida com estes dados. Campos opcionais não informados ficarão sinalizados para completar no Word." : "A gestão receberá os dados para elaborar este tipo de contrato. O download será uma ficha editável com as informações fornecidas."}</p>
    </fieldset>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="form-actions">{onCancel && <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>Cancelar</Button>}<Button type="submit" loading={saving}>{initialRequest ? "Salvar informações" : "Solicitar contrato"}</Button></div>
  </form>;
}
