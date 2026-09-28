"use client";

import { useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { MEETING_RITES, type MeetingRecord } from "@/lib/meeting-rites";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { RaMeeting } from "@/lib/types";
import { FileText, Save } from "lucide-react";

export function MeetingRecordEditor({ meeting, editable, onSaved, onError, onDirtyChange, draft, onDraftChange }: {
  meeting: RaMeeting; editable: boolean; onSaved: () => Promise<void>; onError: (message: string) => void; onDirtyChange: (dirty: boolean) => void; draft?: MeetingRecord; onDraftChange: (record: MeetingRecord) => void;
}) {
  const [record, setRecord] = useState<MeetingRecord>(draft || meeting.record_data || {});
  const [saving, setSaving] = useState(false);
  const rite = MEETING_RITES[meeting.meeting_type];
  async function save(event: FormEvent) {
    event.preventDefault();
    const client = getSupabase();
    if (!client || !editable || saving) return;
    setSaving(true);
    try {
      const { data, error } = await client.from("ra_meetings").update({ record_data: record }).eq("id", meeting.id)
        .eq("updated_at", meeting.updated_at).neq("status", "encerrada").is("archived_at", null).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("A reunião foi alterada ou finalizada. Atualize a página antes de salvar novamente.");
      await onSaved();
    } catch (error) { onError(friendlyError(error)); }
    finally { setSaving(false); }
  }
  return <section className="content-card tlu-meeting-record">
    <div className="content-card-head"><div><h2><FileText size={18} /> Registro do encontro</h2><p>{meeting.meeting_type === "1:1" ? "Somente o líder e o colaborador deste encontro têm acesso. Priorize os encaminhamentos profissionais." : "O registro será incluído na ata ao finalizar a reunião."}</p></div></div>
    <form className="form-grid" onSubmit={save}>
      {rite.fields.map(field => <Field key={field.key} label={field.label} hint={field.hint} className="form-span-2">
        <textarea value={record[field.key] || ""} onChange={event => { const updated = { ...record, [field.key]: event.target.value }; setRecord(updated); onDraftChange(updated); onDirtyChange(true); }} rows={3} maxLength={8000} readOnly={!editable} />
      </Field>)}
      {editable ? <div className="form-actions"><Button type="submit" loading={saving}><Save size={15} /> Salvar registro</Button></div> : null}
    </form>
  </section>;
}
