"use client";
import { useEffect, useState } from "react";
import { resolveQlikCodes } from "@/lib/construction-finance";
import { OperationsError, useOperations } from "./operations-common";
import { Field } from "./ui";
import { paymentFetch } from "@/lib/payment-client";
import type { QlikCompany, QlikWork } from "@/lib/operational-finance";
export function QlikWorkSelect({
  value,
  onChange,
  companyKey,
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  companyKey?: string;
  required?: boolean;
}) {
  const [catalog, setCatalog] = useState<{
    companies: QlikCompany[];
    works: QlikWork[];
  }>({ companies: [], works: [] });
  const [selectedCompany, setSelectedCompany] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    paymentFetch("/api/operations/catalog")
      .then((data) => {
        if (active) setCatalog(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const linked = catalog.works.find((w) => w.key === value);
  const company =
    companyKey !== undefined
      ? catalog.companies.find((c) => c.company_key === companyKey)?.id || ""
      : selectedCompany || linked?.company_id || "";
  const works = catalog.works.filter((w) => w.company_id === company);
  return (
    <>
      {companyKey === undefined ? (
        <Field label="Empresa no Qlik">
          <select
            value={company}
            onChange={(e) => {
              setSelectedCompany(e.target.value);
              onChange("");
            }}
          >
            <option value="">Selecione a empresa</option>
            {catalog.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.id}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field
        label="Obra no Qlik"
        hint={
          error ||
          (loading
            ? "Carregando obras…"
            : company && !works.length
              ? "Esta empresa ainda não tem obras disponíveis na carga."
              : "O vínculo utiliza os identificadores da empresa e da obra.")
        }
      >
        <select
          name="qlik_work_key"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={!company || loading}
          required={required}
        >
          <option value="">
            {company ? "Sem obra vinculada" : "Selecione a empresa primeiro"}
          </option>
          {works.map((w) => (
            <option key={w.key} value={w.key}>
              {w.name} · {w.work_id}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

// Construction variant: users supply codes; names are shown only for verification.
// The existing company/work selects remain unchanged for other product flows.
export function QlikWorkCodes({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string, keys: string[], valid: boolean) => void;
}) {
  const o = useOperations<{ companies: QlikCompany[]; works: QlikWork[] }>(
    `/api/operations/catalog?construction_id=${id}`,
  );
  const resolved = resolveQlikCodes(value, o.data?.works || []);
  return (
    <div className="form-span-2">
      <Field
        label="Código(s) Qlik"
        hint="Digite empresa|unidade, um por linha. Um número simples só é aceito se identificar uma única unidade. Preserve os zeros à esquerda."
      >
        <textarea
          name="qlik_codes"
          rows={3}
          value={value}
          placeholder="empresa|unidade"
          disabled={o.loading}
          onChange={(e) => {
            const next = resolveQlikCodes(e.target.value, o.data?.works || []);
            onChange(
              e.target.value,
              next.keys,
              !!o.data && !o.error && !next.errors.length,
            );
          }}
        />
      </Field>
      <OperationsError message={o.error} />
      {o.loading ? <p role="status">Carregando catálogo Qlik…</p> : null}
      {!o.loading && !o.error ? (
        <div aria-live="polite">
          {resolved.errors.map((error) => (
            <p className="ops-notice" key={error}>
              {error}
            </p>
          ))}
          {resolved.keys.map((key) => {
            const work = o.data!.works.find((w) => w.key === key)!;
            const company = o.data!.companies.find(
              (c) => c.id === work.company_id,
            );
            return (
              <p key={key}>
                <strong>{key}</strong> · {work.name} ·{" "}
                {company?.name || work.company_id}
              </p>
            );
          })}
          {!value.trim() ? (
            <p>
              Sem vínculo. Preencha o código para consultar os gastos desta
              obra.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
