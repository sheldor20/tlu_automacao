"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, StatusPill, Toast } from "@/components/ui";
import { MEETING_RITES, type CollectiveMeetingType, type MeetingTypeMember } from "@/lib/meeting-rites";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { UserProfile } from "@/lib/types";
import { LockKeyhole, Pencil, Users } from "lucide-react";

const types: CollectiveMeetingType[] = ["RAE", "RASP", "RA", "RAO"];
export function MeetingAccessSettings({ users, onSaved }: { users: UserProfile[]; onSaved: () => Promise<void> }) {
  const [members, setMembers] = useState<MeetingTypeMember[]>([]);
  const [editing, setEditing] = useState<CollectiveMeetingType | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const activeUsers = users.filter(user => user.active);
  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client) return;
    const { data, error } = await client.from("ra_meeting_type_members").select("*");
    if (error) setToast({ message: friendlyError(error), type: "error" });
    else setMembers(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function save() {
    const client = getSupabase();
    if (!client || !editing || saving) return;
    setSaving(true);
    try {
      const { error } = await client.rpc("set_ra_meeting_type_members", { p_type: editing, p_user_ids: selection });
      if (error) throw error;
      await load(); await onSaved();
      setEditing(null);
      setToast({ message: "Participantes e acessos atualizados. A nova lista será sugerida nas próximas reuniões.", type: "success" });
    } catch (error) { setToast({ message: friendlyError(error), type: "error" }); }
    finally { setSaving(false); }
  }
  const missingAylton = !activeUsers.some(user => /^aylton(?:\s|$)/i.test(user.full_name || ""));
  return <section className="content-card tlu-access-settings">
    <div className="content-card-head"><div><h2><Users size={18} /> Reuniões TLU · participantes e acesso</h2><p>Defina quem acessa cada agenda e aparece como participante sugerido. Administradores podem gerenciar as reuniões coletivas.</p></div></div>
    {loading ? <div className="list-loading">Carregando acessos…</div> : <div className="tlu-access-grid">{types.map(type => {
      const ids = members.filter(member => member.meeting_type === type).map(member => member.user_id);
      return <article key={type}><div className="tlu-access-title"><strong>{type}</strong><StatusPill tone="neutral">{ids.length} participantes</StatusPill></div><h3>{MEETING_RITES[type].name}</h3><p>{MEETING_RITES[type].cadence}</p><div className="ra-participant-chips">{ids.map(id => <span key={id}>{users.find(user => user.user_id === id)?.full_name || "Usuário indisponível"}</span>)}</div><Button variant="secondary" onClick={() => { setEditing(type); setSelection(ids); }}><Pencil size={14} /> Editar participantes</Button></article>;
    })}</div>}
    {missingAylton ? <p className="tlu-access-note">Cadastro pendente: Aylton foi previsto para RAE e RA, mas ainda não foi encontrado entre os usuários ativos. Após identificar ou cadastrar o usuário, inclua-o nas duas listas.</p> : null}
    <div className="tlu-private-note"><LockKeyhole size={18} /><p><strong>1:1 · acesso individual</strong><br />Todos podem ter um 1:1. Somente o líder e o colaborador daquele encontro veem seus registros, inclusive quando há administradores na empresa. Configure o vínculo em “Editar usuário → Líder direto”. O histórico permanece com a dupla original.</p></div>
    <Dialog open={Boolean(editing)} onClose={() => { if (!saving) setEditing(null); }} title={`Participantes · ${editing || ""}`} description="A alteração vale imediatamente para o acesso às agendas deste tipo. Os participantes registrados em encontros anteriores são preservados." wide>
      <form onSubmit={event => { event.preventDefault(); void save(); }} className="form-grid">
        <fieldset className="department-access-fieldset form-span-2"><legend>Usuários autorizados</legend><div className="ra-choice-grid">{activeUsers.map(user => <label key={user.user_id} className={selection.includes(user.user_id) ? "selected" : ""}><input type="checkbox" checked={selection.includes(user.user_id)} disabled={saving} onChange={() => setSelection(current => current.includes(user.user_id) ? current.filter(id => id !== user.user_id) : [...current,user.user_id])} /><span>{user.full_name || user.email}</span></label>)}</div></fieldset>
        <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button><Button type="submit" loading={saving}>Salvar participantes</Button></div>
      </form>
    </Dialog>
    {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
  </section>;
}
