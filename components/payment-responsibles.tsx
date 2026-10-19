"use client";
import { useCallback, useEffect, useState } from "react";
import { paymentFetch } from "@/lib/payment-client";
import { Button, Field } from "./ui";
type Assigned = { user_id: string; profile: { full_name: string; active: boolean; deleted_at: string | null } };
type Candidate = { user_id: string; full_name: string };
export function PaymentResponsibles({ id, version, canAssign, onChanged }: {
  id: string; version: number; canAssign: boolean; onChanged: () => void;
}) {
  const [assigned, setAssigned] = useState<Assigned[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await paymentFetch(`/api/payments/${id}/responsibles`);
      setAssigned(result.assigned); setCandidates(result.candidates); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar os responsáveis."); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load, version]);
  async function change(target: string, remove: boolean) {
    setBusy(true); setError("");
    try {
      await paymentFetch(`/api/payments/${id}/responsibles`, { method: "POST", body: JSON.stringify({ user_id: target, remove, version }) });
      setUserId(""); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return <section className="payment-section" aria-label="Responsáveis pelo pagamento">
    <h2>Responsáveis pelo pagamento</h2>
    <p>Os usuários vinculados podem tratar esta solicitação na Gestão de pagamentos.</p>
    {loading ? <p>Carregando responsáveis…</p> : assigned.length ? <ul>{assigned.map((user) => <li key={user.user_id}>
      {user.profile.full_name}{(!user.profile.active || user.profile.deleted_at) ? " (acesso desativado)" : ""}{" "}
      {canAssign && <Button variant="secondary" disabled={busy} onClick={() => void change(user.user_id, true)}>Remover vínculo de {user.profile.full_name}</Button>}
    </li>)}</ul> : <p>Nenhum responsável vinculado.</p>}
    {canAssign && <form onSubmit={(event) => { event.preventDefault(); if (userId) void change(userId, false); }}>
      <Field label="Adicionar responsável"><select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={busy || loading} required>
        <option value="">Selecione um usuário ativo</option>
        {candidates.filter((candidate) => !assigned.some((user) => user.user_id === candidate.user_id)).map((user) => <option key={user.user_id} value={user.user_id}>{user.full_name}</option>)}
      </select></Field>
      <Button type="submit" disabled={busy || loading || !userId}>Adicionar responsável</Button>
    </form>}
    {error && <p role="alert" className="payment-alert">{error}</p>}
  </section>;
}
