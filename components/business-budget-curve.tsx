"use client";
import { useEffect, useState } from "react";
import { Button, Dialog, Field } from "./ui";
import { paymentFetch } from "@/lib/payment-client";
import { currency } from "@/lib/format";
import { parseBusinessCurve } from "@/lib/budget-planner";
import type { Business } from "@/lib/types";
export function BusinessBudgetCurve({
  business,
  onClose,
  onSaved,
}: {
  business: Business;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [csv, setCsv] = useState("mes;vgv;investimento\n1;0;0");
  const [version, setVersion] = useState(0),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [canWrite, setCanWrite] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    paymentFetch(`/api/budget/businesses?id=${business.id}`)
      .then((r) => {
        if (!active) return;
        setVersion(r.version);
        setCanWrite(r.canWrite);
        if (r.curve.length)
          setCsv(
            "mes;vgv;investimento\n" +
              r.curve
                .map(
                  (row: { month: number; vgv: number; investment: number }) =>
                    `${row.month};${row.vgv};${row.investment}`,
                )
                .join("\n"),
          );
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
  }, [business.id]);
  let summary = "",
    validation = "";
  try {
    const curve = parseBusinessCurve(csv);
    summary = `VGV: ${currency(curve.reduce((n, r) => n + r.vgv, 0))} · Investimento: ${currency(curve.reduce((n, r) => n + r.investment, 0))}`;
  } catch (e) {
    validation = (e as Error).message;
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      await paymentFetch("/api/budget/businesses", {
        method: "POST",
        body: JSON.stringify({
          business_id: business.id,
          curve: parseBusinessCurve(csv),
          version,
        }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Curva mensal · ${business.name}`}
      description="Recebimentos previstos e investimento da obra, em reais."
      wide
    >
      <p>
        O mês 1 do investimento é o início da obra. O mês 1 do VGV é o primeiro
        mês após a conclusão. Cada coluna usa sua própria referência. Meses
        omitidos valem zero.
      </p>
      <p>
        Ao salvar, a soma do VGV mensal atualiza o VGV total do negócio.
        Cenários já salvos mantêm a curva original até você atualizá-la no
        planejador.
      </p>
      <Field
        label="Importar CSV ou TSV"
        hint="Colunas: mes;vgv;investimento. Até 120 meses. Use ponto decimal ou vírgula decimal com separador ponto e vírgula."
      >
        <input
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          disabled={loading || !canWrite}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              if (file.size > 100000)
                throw new Error("Use um arquivo de até 100 KB.");
              const text = await file.text();
              parseBusinessCurve(text);
              setCsv(text);
              setError("");
            } catch (error) {
              setError((error as Error).message);
            }
            e.target.value = "";
          }}
        />
      </Field>
      <Field
        label="Curva mensal"
        hint="Você também pode colar as três colunas de uma planilha."
      >
        <textarea
          aria-label="Curva mensal"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={12}
          disabled={loading || !canWrite}
          style={{ fontFamily: "monospace", width: "100%" }}
        />
      </Field>
      <p>
        <strong>{summary}</strong>
      </p>
      {validation || error ? (
        <p role="alert" className="form-alert">
          {error || validation}
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
        <Button
          onClick={save}
          disabled={loading || saving || !canWrite || !!validation}
          loading={saving}
        >
          Salvar curva mensal
        </Button>
      </div>
    </Dialog>
  );
}
