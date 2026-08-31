"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { StatusPill } from "@/components/ui";
import { TASK_COLUMNS } from "@/lib/constants";
import { dateBr, initials, todayIso } from "@/lib/format";
import type { ProjectSubtask, ProjectTask, TaskStatus, UserProfile } from "@/lib/types";
import { Calendar, Check, ChevronDown, ChevronUp, Circle, FolderKanban, GripVertical, Pencil, Plus, Trash2, Users } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

type ProjectTaskBoardProps = {
  tasks: ProjectTask[];
  movingTaskId: string | null;
  onStatusChange: (task: ProjectTask, status: TaskStatus) => Promise<void>;
  onAddTask: (status: TaskStatus) => void;
  onEditTask?: (task: ProjectTask) => void;
  onToggleSubtask?: (task: ProjectTask, subtask: ProjectSubtask, completed: boolean) => Promise<void>;
  users: UserProfile[];
  canAddTask?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  onDeleteTask?: (task: ProjectTask) => Promise<void>;
};

type TaskCardProps = Pick<ProjectTaskBoardProps, "onStatusChange" | "onEditTask" | "onToggleSubtask" | "onDeleteTask"> & {
  task: ProjectTask;
  disabled?: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

function taskAssignees(task: ProjectTask) {
  return task.assignees?.length ? task.assignees : task.assignee_user_id ? [{
    task_id: task.id,
    user_id: task.assignee_user_id,
    assignee_name: task.assignee_name,
    assignee_email: task.assignee_email,
  }] : [];
}

function TaskCardContent({ task, dragHandle, expanded = false }: { task: ProjectTask; dragHandle?: ReactNode; expanded?: boolean }) {
  const overdue = task.status !== "concluida" && task.due_date < todayIso();
  const assignees = taskAssignees(task);
  const subtasks = task.subtasks || [];
  const completedSubtasks = subtasks.filter((subtask) => subtask.completed_at).length;

  return (
    <>
      <div className="task-card-top">
        <div className="task-avatar-stack">{assignees.slice(0, 3).map((assignee) => <span key={assignee.user_id} title={assignee.assignee_name}>{initials(assignee.assignee_name)}</span>)}{assignees.length > 3 ? <span>+{assignees.length - 3}</span> : null}</div>
        <div className="task-card-actions">
          {overdue ? <StatusPill tone="danger">Atrasada</StatusPill> : task.status === "concluida" ? <StatusPill tone="success">Concluída</StatusPill> : null}
          {dragHandle}
        </div>
      </div>
      <h4>{task.title}</h4>
      {expanded && task.description ? <p>{task.description}</p> : null}
      {subtasks.length ? <div className="task-subtask-progress"><span><Check size={12} /> {completedSubtasks}/{subtasks.length} subitens</span><i><b style={{ width: `${(completedSubtasks / subtasks.length) * 100}%` }} /></i></div> : null}
      <div className={`task-meta ${task.status === "concluida" && !expanded ? "task-meta-completed" : ""}`}>
        {task.project_name ? <span><FolderKanban size={12} /> {task.project_name}</span> : null}
        <span><Users size={12} /> {assignees.map((assignee) => assignee.assignee_name).join(", ") || "Sem responsável"}</span>
        <span className={overdue ? "text-danger" : ""}><Calendar size={12} /> {dateBr(task.due_date)}</span>
      </div>
    </>
  );
}

function TaskCard({ task, disabled, onStatusChange, onEditTask, onToggleSubtask, canEdit, canDelete, onDeleteTask }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled, data: { status: task.status } });
  const style: CSSProperties = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scaleX}, ${transform.scaleY})` } : {};

  return (
    <article ref={setNodeRef} style={style} className={`task-card ${task.status === "concluida" ? "task-card-completed" : "task-card-collapsed"} ${expanded ? "task-card-expanded" : ""} ${task.status !== "concluida" && task.due_date < todayIso() ? "task-overdue" : ""} ${isDragging ? "task-card-dragging" : ""}`}>
      <TaskCardContent task={task} expanded={expanded} dragHandle={<button type="button" className="task-drag-handle" aria-label={`Arrastar a atividade ${task.title}`} title="Arrastar atividade" disabled={disabled} {...listeners} {...attributes}><GripVertical size={16} /></button>} />
      {expanded ? <>
        <select value={task.status} onChange={(event) => void onStatusChange(task, event.target.value as TaskStatus)} aria-label={`Mudar status de ${task.title}`} disabled={disabled}>{TASK_COLUMNS.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}</select>
        {(task.subtasks || []).length ? <div className="task-subtask-list">{task.subtasks!.map((subtask) => {
          const assigneeNames = subtask.assignees?.map((assignee) => assignee.assignee_name).join(", ");
          const completed = Boolean(subtask.completed_at);
          return <label key={subtask.id} className={completed ? "completed" : ""}><button type="button" onClick={() => void onToggleSubtask?.(task, subtask, !completed)} disabled={disabled || !onToggleSubtask} aria-label={`${completed ? "Reabrir" : "Concluir"} ${subtask.title}`}>{completed ? <Check size={13} /> : <Circle size={13} />}</button><span><strong>{subtask.title}</strong>{assigneeNames ? <small>{assigneeNames}</small> : null}</span></label>;
        })}</div> : <div className="task-no-subtasks">Sem subtarefas cadastradas.</div>}
      </> : null}
      <div className="task-card-footer-actions">
        <button type="button" className="task-detail-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{expanded ? "Recolher" : "Detalhes"}</button>
        {canEdit && onEditTask ? <button type="button" className="task-edit-button" onClick={() => onEditTask(task)} disabled={disabled}><Pencil size={13} /> Editar</button> : null}
        {canDelete && onDeleteTask ? <button type="button" className="task-delete-button" onClick={() => void onDeleteTask(task)} disabled={disabled} aria-label={`Excluir a atividade ${task.title}`}><Trash2 size={14} /> Excluir</button> : null}
      </div>
    </article>
  );
}

function TaskColumn({ status, label, tasks, movingTaskId, onStatusChange, onAddTask, onEditTask, onToggleSubtask, canAddTask, canEdit, canDelete, onDeleteTask }: Omit<ProjectTaskBoardProps, "users"> & { status: TaskStatus; label: string }) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} className={`kanban-column column-${status} ${isOver ? "kanban-column-drop-target" : ""}`}>
      <header><div><span className="column-dot" /><h3>{label}</h3></div><strong>{tasks.length}</strong></header>
      <div className="kanban-tasks">
        {tasks.map((task) => <TaskCard task={task} disabled={Boolean(movingTaskId)} onStatusChange={onStatusChange} onEditTask={onEditTask} onToggleSubtask={onToggleSubtask} canEdit={Boolean(canEdit)} canDelete={Boolean(canDelete)} onDeleteTask={onDeleteTask} key={task.id} />)}
        {tasks.length === 0 ? <div className="column-empty">Solte uma atividade aqui.</div> : null}
      </div>
      {canAddTask ? <button className="kanban-add" onClick={() => onAddTask(status)}><Plus size={15} /> Adicionar atividade</button> : null}
    </section>
  );
}

export function ProjectTaskBoard(props: ProjectTaskBoardProps) {
  const { tasks, movingTaskId, onStatusChange, onAddTask, onEditTask, onToggleSubtask, canAddTask = true, canEdit = true, canDelete = false, onDeleteTask } = props;
  const [activeTask, setActiveTask] = useState<ProjectTask | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }), useSensor(KeyboardSensor));

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const task = tasks.find((item) => item.id === event.active.id);
    const nextStatus = event.over?.id as TaskStatus | undefined;
    if (!task || !nextStatus || !TASK_COLUMNS.some((column) => column.key === nextStatus)) return;
    void onStatusChange(task, nextStatus);
  }

  return (
    <DndContext sensors={sensors} onDragStart={(event) => setActiveTask(tasks.find((item) => item.id === event.active.id) || null)} onDragCancel={() => setActiveTask(null)} onDragEnd={handleDragEnd}>
      <div className="kanban-board">{TASK_COLUMNS.map((column) => <TaskColumn status={column.key} label={column.label} tasks={tasks.filter((task) => task.status === column.key)} movingTaskId={movingTaskId} onStatusChange={onStatusChange} onAddTask={onAddTask} onEditTask={onEditTask} onToggleSubtask={onToggleSubtask} canAddTask={canAddTask} canEdit={canEdit} canDelete={canDelete} onDeleteTask={onDeleteTask} key={column.key} />)}</div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>{activeTask ? <article className="task-card task-drag-overlay"><TaskCardContent task={activeTask} /></article> : null}</DragOverlay>
    </DndContext>
  );
}
