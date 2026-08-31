"use client";

import { UserMultiSelect } from "@/components/user-multi-select";
import { Button, Dialog, Field } from "@/components/ui";
import { TASK_COLUMNS } from "@/lib/constants";
import type { Project, ProjectTask, TaskStatus, UserProfile } from "@/lib/types";
import { ListPlus, Plus, Trash2 } from "lucide-react";
import type { FormEvent } from "react";

export type ProjectSubtaskDraft = {
  id?: string;
  title: string;
  completed: boolean;
  assignee_user_ids: string[];
};

export type ProjectTaskDraft = {
  id?: string;
  project_id: string;
  title: string;
  description: string;
  due_date: string;
  status: TaskStatus;
  assignee_user_ids: string[];
  subtasks: ProjectSubtaskDraft[];
};

export function taskToDraft(task: ProjectTask): ProjectTaskDraft {
  return {
    id: task.id,
    project_id: task.project_id || "",
    title: task.title,
    description: task.description || "",
    due_date: task.due_date,
    status: task.status,
    assignee_user_ids: task.assignees?.map((assignee) => assignee.user_id) || (task.assignee_user_id ? [task.assignee_user_id] : []),
    subtasks: (task.subtasks || []).map((subtask) => ({
      id: subtask.id,
      title: subtask.title,
      completed: Boolean(subtask.completed_at),
      assignee_user_ids: subtask.assignees?.map((assignee) => assignee.user_id) || [],
    })),
  };
}

export function ProjectTaskEditor({
  open,
  onClose,
  onSubmit,
  form,
  onChange,
  users,
  projects,
  lockProject = false,
  saving = false,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  form: ProjectTaskDraft;
  onChange: (form: ProjectTaskDraft) => void;
  users: UserProfile[];
  projects?: Project[];
  lockProject?: boolean;
  saving?: boolean;
}) {
  function addSubtask() {
    onChange({ ...form, subtasks: [...form.subtasks, { title: "", completed: false, assignee_user_ids: [] }] });
  }

  function updateSubtask(index: number, updates: Partial<ProjectSubtaskDraft>) {
    onChange({ ...form, subtasks: form.subtasks.map((subtask, itemIndex) => itemIndex === index ? { ...subtask, ...updates } : subtask) });
  }

  function removeSubtask(index: number) {
    onChange({ ...form, subtasks: form.subtasks.filter((_, itemIndex) => itemIndex !== index) });
  }

  return (
    <Dialog open={open} onClose={onClose} title={form.id ? "Editar atividade" : "Nova atividade"} description="Defina a entrega, os responsáveis e os subitens que serão acompanhados no cartão." wide>
      <form className="form-grid task-editor-form" onSubmit={onSubmit}>
        {projects && !lockProject ? <Field label="Projeto"><select value={form.project_id} onChange={(event) => onChange({ ...form, project_id: event.target.value })}><option value="">Atividade avulsa</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field> : null}
        <Field label="Status inicial"><select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as TaskStatus })}>{TASK_COLUMNS.map((column) => <option value={column.key} key={column.key}>{column.label}</option>)}</select></Field>
        <Field label="Atividade" className={projects && !lockProject ? "form-span-2" : undefined}><input value={form.title} onChange={(event) => onChange({ ...form, title: event.target.value })} required minLength={2} maxLength={220} /></Field>
        <Field label="Responsáveis" hint="A atividade aparecerá para todas as pessoas selecionadas." className="form-span-2"><UserMultiSelect users={users} value={form.assignee_user_ids} onChange={(assignee_user_ids) => onChange({ ...form, assignee_user_ids })} /></Field>
        <Field label="Data de entrega"><input type="date" value={form.due_date} onChange={(event) => onChange({ ...form, due_date: event.target.value })} required /></Field>
        <Field label="Descrição"><textarea value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} maxLength={4000} /></Field>

        <section className="subtask-editor form-span-2">
          <header><div><ListPlus size={18} /><span><strong>Subtarefas</strong><small>Bullets com conclusão e responsáveis próprios</small></span></div><Button type="button" variant="secondary" onClick={addSubtask}><Plus size={15} /> Adicionar subitem</Button></header>
          {form.subtasks.length ? <div className="subtask-editor-list">{form.subtasks.map((subtask, index) => (
            <article key={subtask.id || `new-${index}`}>
              <label className="subtask-completed"><input type="checkbox" checked={subtask.completed} onChange={(event) => updateSubtask(index, { completed: event.target.checked })} /><span>Feita</span></label>
              <input value={subtask.title} onChange={(event) => updateSubtask(index, { title: event.target.value })} placeholder="Descreva o subitem" required maxLength={220} />
              <UserMultiSelect users={users} value={subtask.assignee_user_ids} onChange={(assignee_user_ids) => updateSubtask(index, { assignee_user_ids })} />
              <button type="button" className="subtask-remove" onClick={() => removeSubtask(index)} aria-label={`Excluir subitem ${index + 1}`}><Trash2 size={16} /></button>
            </article>
          ))}</div> : <div className="subtask-editor-empty">Nenhum subitem. A atividade pode ser salva sem subtarefas.</div>}
        </section>

        <div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" loading={saving} disabled={!form.assignee_user_ids.length || form.subtasks.some((subtask) => !subtask.assignee_user_ids.length)}>{form.id ? "Salvar alterações" : "Criar atividade"}</Button></div>
      </form>
    </Dialog>
  );
}
