"use client";
import { useEffect, useState } from "react";
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
