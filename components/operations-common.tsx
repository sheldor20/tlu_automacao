"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import { paymentFetch } from "@/lib/payment-client";
import { Button } from "./ui";
import "./operations.css";
export const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "A informar"
    : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const day = (d: string | null | undefined) =>
  d
    ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("pt-BR")
    : "Não informado";
export function useOperations<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await paymentFetch(url);
      if (current === generation.current) setData(result);
    } catch (e) {
      if (current === generation.current)
        setError(
          e instanceof Error
            ? e.message
            : "Não foi possível carregar os dados.",
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    let active = true;
    setTimeout(() => {
      if (active) void reload();
    }, 0);
    return () => {
      active = false;
      // This is a request generation counter, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [reload]);
  const save = async (endpoint: string, body: unknown) => {
    setSaving(true);
    setError("");
    try {
      await paymentFetch(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { data, loading, error, reload, save, saving, setError };
}
export function OperationsHeader({
  title,
  description,
  onRefresh,
  loading,
  children,
}: {
  title: string;
  description: string;
  onRefresh: () => void;
  loading: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="ops-header">
      <div>
        <span className="ops-eyebrow">TERRA LOTUS · GESTÃO INTEGRADA</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="ops-actions">
        {children}
        <Button variant="secondary" loading={loading} onClick={onRefresh}>
          <RefreshCw size={16} />
          Atualizar
        </Button>
      </div>
    </header>
  );
}
export function OperationsError({ message }: { message: string }) {
  return message ? (
    <div className="ops-notice ops-error" role="alert">
      <AlertCircle size={18} />
      {message}
    </div>
  ) : null;
}
export function OperationsEmpty({ text }: { text: string }) {
  return <div className="ops-empty">{text}</div>;
}

export function OperationsDataStatus({
  sources,
}: {
  sources: Array<"catalog" | "receivable" | "payable" | "received" | "paid">;
}) {
  const o = useOperations<{
    active: boolean;
    checked_at: string;
    sources: Record<string, { at: string | null; status: string }>;
  }>("/api/operations/status");
  if (!o.data) return null;
  const labels: Record<string, string> = {
    catalog: "empresas e obras",
    receivable: "contas a receber",
    payable: "contas a pagar",
    received: "recebimentos",
    paid: "pagamentos",
  };
  const pending = sources.filter((k) => !o.data!.sources[k]?.at),
    failed = sources.filter((k) => o.data!.sources[k]?.status === "error");
  const dates = sources
    .map((k) => o.data!.sources[k]?.at)
    .filter((d): d is string => !!d)
    .sort();
  const stale =
    dates.length &&
    Date.parse(o.data.checked_at) - Date.parse(dates[0]) > 36 * 3600000;
  return (
    <div
      className={
        pending.length || failed.length || stale ? "ops-notice" : "ops-subtle"
      }
      role="status"
    >
      {pending.length ? (
        `Carga pendente: ${pending.map((k) => labels[k]).join(", ")}. Os totais podem estar incompletos.`
      ) : (
        <>
          Qlik atualizado até{" "}
          {new Date(dates[0]).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
          })}
          .
        </>
      )}
      {failed.length
        ? ` A última atualização de ${failed.map((k) => labels[k]).join(", ")} falhou; a carga anterior foi preservada.`
        : ""}
      {stale ? " A origem está há mais de 36 horas sem atualização." : ""}
      {!o.data.active ? " A sincronização automática está pausada." : ""}
    </div>
  );
}
