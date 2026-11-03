"use client";

import { Button, Field, PageIntro } from "@/components/ui";
import { getSupabase } from "@/lib/supabase";
import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

export default function NewRentalPage() {
  const router = useRouter();
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const fields = new FormData(event.currentTarget);
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      const supabase = getSupabase();
      const session = supabase ? await supabase.auth.getSession() : null;
      const token = session?.data.session?.access_token;
      if (!token) throw new Error("Entre novamente no sistema para cadastrar o imóvel.");
      const response = await fetch("/api/rentals", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: fields.get("name"), qlik_property_id: fields.get("qlik_property_id"),
          property_address: fields.get("property_address"), lessor_name: fields.get("lessor_name"),
          lessor_type: fields.get("lessor_type"), property_type: fields.get("property_type"),
          rentable: fields.get("rentable") === "true",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível cadastrar o imóvel.");
      router.replace(`/alugueis/${result.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha de conexão. Tente novamente.");
      submitting.current = false;
      setSaving(false);
    }
  }

  return <>
    <Link href="/alugueis" className="detail-back"><ArrowLeft size={15} /> Voltar para Aluguéis</Link>
    <PageIntro eyebrow="Aluguéis · Cadastro" title="Novo imóvel" description="Cadastre o imóvel e depois envie o contrato na ficha." />
    <section className="content-card rental-edit-card">
      <div className="content-card-head"><div><h2>Imóvel e vínculo com o Qlik</h2><p>Use o código exato do imóvel no Qlik, incluindo zeros e separadores. A próxima sincronização atualizará nome, tipo e permissão para locação, preservando os dados do contrato.</p></div></div>
      <form onSubmit={save} className="content-card-body">
        <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="form-grid">
            <Field label="Nome do imóvel"><input name="name" required minLength={2} maxLength={140} /></Field>
            <Field label="Código do imóvel no Qlik" hint="O cadastro é feito neste sistema. Ele não cria nem altera imóveis dentro do Qlik."><input name="qlik_property_id" required maxLength={200} placeholder="Ex.: 1|009" /></Field>
            <Field label="Endereço do imóvel"><input name="property_address" required minLength={5} maxLength={260} /></Field>
            <Field label="Tipo de imóvel"><select name="property_type"><option>Imóvel Comercial</option><option>Imóvel Residencial</option><option>Terreno</option><option>Área</option></select></Field>
            <Field label="Pode ser locado?"><select name="rentable"><option value="true">Sim</option><option value="false">Não</option></select></Field>
            <Field label="Tipo do locador"><select name="lessor_type"><option value="pj">Pessoa jurídica</option><option value="pf">Pessoa física</option></select></Field>
            <Field label="Nome do locador"><input name="lessor_name" required minLength={2} maxLength={160} /></Field>
          </div>
          <p>O imóvel começa como desocupado. Na próxima tela, envie o contrato e revise a ocupação, os valores e as datas da locação.</p>
          {error ? <p role="alert">{error}</p> : null}
          <div className="form-actions"><Button type="submit" loading={saving}><Plus size={16} /> Cadastrar e abrir ficha</Button></div>
        </fieldset>
      </form>
    </section>
  </>;
}
