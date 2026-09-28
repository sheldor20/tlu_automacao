"use client";

import { useState, type FormEvent } from "react";
import { Button, Dialog, Field, StatusPill } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase";
import { dateBr } from "@/lib/format";
import type { RaMeeting } from "@/lib/types";
import { FileText, History, Mail, Pencil, Save } from "lucide-react";

type Revision = { id: string; revision: number; previous_text: string | null; minutes_text: string; edited_at: string; edited_by: string };
export function MeetingMinutes({ meeting, canEdit, canResend, onResend, onSaved, onError, userName }: {
  meeting: RaMeeting; canEdit: boolean; canResend: boolean; onResend: () => Promise<void>;
  onSaved: () => Promise<void>; onError: (message: string) => void; userName: (id: string | null) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<Revision[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    const client = getSupabase();
    if (!client || !canEdit || saving) return;
    setSaving(true);
    try {
      const { error } = await client.rpc("revise_ra_minutes", { p_meeting_id: meeting.id, p_minutes: draft, p_expected_revision: meeting.minutes_revision });
      if (error) throw error;
      setEditing(false); await onSaved();
    } catch (error) { onError(friendlyError(error)); }
    finally { setSaving(false); }
  }
  async function showHistory() {
    const client = getSupabase();
    if (!client) return;
    setHistoryLoading(true);
    const { data, error } = await client.from("ra_minutes_revisions").select("*").eq("meeting_id", meeting.id).order("revision", { ascending: false });
    setHistoryLoading(false);
    if (error) return onError(friendlyError(error));
    setHistory(data || []);
  }
  return <section className="content-card ra-minutes">
    <div className="content-card-head"><div><h2><FileText size={18} /> Ata da reunião</h2><p>{meeting.minutes_edited_at ? `Revisão ${meeting.minutes_revision} · ${dateBr(meeting.minutes_edited_at)} · ${userName(meeting.minutes_edited_by)}` : "Registro final da reunião"}</p></div>
      <div className="page-action-group">
        {canEdit ? <Button variant="secondary" onClick={() => { setDraft(meeting.minutes_text || ""); setEditing(true); }}><Pencil size={15} /> Editar ata</Button> : null}
        {meeting.minutes_revision > 0 ? <Button variant="ghost" loading={historyLoading} onClick={() => void showHistory()}><History size={15} /> Histórico</Button> : null}
        {canResend ? <Button variant="secondary" onClick={() => void onResend()}><Mail size={15} /> Reenviar ATA</Button> : null}
      </div>
    </div>
    <pre>{meeting.minutes_text}</pre>
    <Dialog open={editing} onClose={() => { if (!saving) setEditing(false); }} title="Editar ata finalizada" description="A reunião continuará encerrada. A versão anterior, o autor e a data da alteração serão preservados. Para enviar a correção por e-mail, use Reenviar ATA após salvar." wide>
      <form className="form-grid" onSubmit={save}><Field label="Texto da ata" className="form-span-2"><textarea value={draft} onChange={event => setDraft(event.target.value)} rows={18} minLength={2} maxLength={200000} required disabled={saving} /></Field><div className="form-actions"><Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>Cancelar</Button><Button type="submit" loading={saving}><Save size={15} /> Salvar correção</Button></div></form>
    </Dialog>
    <Dialog open={history !== null} onClose={() => setHistory(null)} title="Histórico da ata" description="Versões preservadas após cada correção administrativa." wide>
      <div className="tlu-minutes-history">{history?.map(revision => <details key={revision.id}><summary><StatusPill tone="info">Revisão {revision.revision}</StatusPill> {dateBr(revision.edited_at)} · {userName(revision.edited_by)}</summary><h3>Texto desta revisão</h3><pre>{revision.minutes_text}</pre><h3>Texto anterior</h3><pre>{revision.previous_text}</pre></details>)}</div>
    </Dialog>
  </section>;
}
