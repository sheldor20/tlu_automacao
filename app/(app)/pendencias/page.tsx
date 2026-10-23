"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { getSupabase, friendlyError } from "@/lib/supabase";
import { todayIso, dateBr } from "@/lib/format";
import type { ProjectTask, TodayVisibleUser } from "@/lib/types";
import Link from "next/link";

type Task = Pick<ProjectTask, "id" | "title" | "due_date" | "status" | "project_id" | "category"> & { project_name: string };
type Group = { user: TodayVisibleUser; tasks: Task[] };
type Dashboard = { users: TodayVisibleUser[]; tasks: Task[] };

export default function PendingPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError(""); setGroups([]);
    try {
      const db = getSupabase();
      if (!db) throw new Error("Conexão com o sistema indisponível.");
      const initial = await db.rpc("today_dashboard", { p_user_id: null });
      if (initial.error) throw initial.error;
      const dashboard = initial.data as Dashboard;
      const result: Group[] = [];
      for (const user of dashboard.users) {
        const response = await db.rpc("today_dashboard", { p_user_id: user.user_id });
        if (response.error) throw response.error;
        const tasks = (response.data as Dashboard).tasks.filter(t => t.status !== "concluida" && t.due_date && t.due_date.slice(0, 10) < todayIso()).sort((a,b) => a.due_date.localeCompare(b.due_date));
        if (tasks.length) result.push({ user, tasks });
      }
      setGroups(result.sort((a,b) => (a.user.full_name || a.user.email).localeCompare(b.user.full_name || b.user.email)));
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function download() {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF(); let y = 20;
      const line = (value: string, size = 11) => {
        doc.setFontSize(size);
        for (const text of doc.splitTextToSize(value, 175) as string[]) {
          if (y > 278) { doc.addPage(); y = 20; }
          doc.text(text, 18, y); y += 6;
        }
      };
      line("Terra Lótus · Pendências", 18);
      line(`Emitido em ${dateBr(todayIso())}`);
      for (const { user, tasks } of groups) {
        y += 5; line(`${user.full_name} (${tasks.length})`, 14); line(user.email || "Email não cadastrado");
        for (const task of tasks) line(`• ${task.title} | ${task.project_name || "Sem projeto"} | Prazo: ${dateBr(task.due_date)}`);
      }
      doc.save(`pendencias-${todayIso()}.pdf`);
    } catch { setError("Não foi possível gerar o PDF. Tente novamente."); }
  }
  function email(group: Group) {
    const body = `Olá, ${group.user.full_name}.\n\nAs tarefas abaixo estão atrasadas. Por favor, atualize o andamento e informe a previsão de conclusão.\n\n${group.tasks.map(t => `• ${t.title} — ${t.project_name || "Sem projeto"} — Prazo: ${dateBr(t.due_date)}`).join("\n")}\n\nObrigado.`;
    window.location.href = `mailto:${encodeURIComponent(group.user.email)}?subject=${encodeURIComponent("Pendências de tarefas · Terra Lótus")}&body=${encodeURIComponent(body)}`;
  }
  return <div className="page-stack">
    <div className="content-card-head"><div><h1>Pendências por pessoa</h1><p>Tarefas abertas com prazo vencido, conforme suas permissões de acesso.</p></div><div><Button onClick={() => void load()} disabled={loading}>Atualizar</Button> <Button onClick={() => void download()} disabled={loading || !!error || !groups.length}>Baixar PDF completo</Button></div></div>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Carregando pendências…</p> : !error && <p>{groups.length} pessoa(s) com pendências · {new Set(groups.flatMap(g => g.tasks.map(t => t.id))).size} tarefa(s) atrasada(s)</p>}
    {!loading && !error && !groups.length && <div className="content-card">Nenhuma tarefa atrasada encontrada.</div>}
    {!loading && !error && groups.map(group => <section className="content-card" key={group.user.user_id}>
      <div className="content-card-head"><div><h2>{group.user.full_name}</h2><p>{group.user.email} · {group.tasks.length} tarefa(s)</p></div><Button disabled={!group.user.email} onClick={() => email(group)}>Preparar email de cobrança</Button></div>
      <ul>{group.tasks.map(task => <li key={task.id} style={{ marginBottom: 16 }}><Link href={`${task.category === "governance" ? "/governanca" : "/projetos"}${task.project_id ? `/${task.project_id}?tab=tarefas` : "#quadro-tarefas"}`}>{task.title}</Link><p>{task.project_name || "Sem projeto"} · Prazo: {dateBr(task.due_date)} · {task.status === "em_andamento" ? "Em andamento" : "A fazer"}</p></li>)}</ul>
    </section>)}
  </div>;
}
