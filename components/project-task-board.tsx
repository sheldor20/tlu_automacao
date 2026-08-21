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
import type { ProjectTask, TaskStatus, UserProfile } from "@/lib/types";
import { Calendar, ChevronDown, ChevronUp, FolderKanban, GripVertical, Plus, Trash2, Users } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

type ProjectTaskBoardProps = {
  tasks: ProjectTask[];
  movingTaskId: string | null;
  onStatusChange: (task: ProjectTask, status: TaskStatus) => Promise<void>;
  onTaskUpdate: (task: ProjectTask, updates: Partial<Pick<ProjectTask, "assignee_user_id" | "due_date">>) => Promise<void>;
  onAddTask: (status: TaskStatus) => void;
  users: UserProfile[];
  canAddTask?: boolean;
  canReassign?: boolean;
  canDelete?: boolean;
  onDeleteTask?: (task: ProjectTask) => Promise<void>;
};

type TaskCardProps = {
  task: ProjectTask;
  disabled?: boolean;
  onStatusChange: (task: ProjectTask, status: TaskStatus) => Promise<void>;
  onTaskUpdate: (task: ProjectTask, updates: Partial<Pick<ProjectTask, "assignee_user_id" | "due_date">>) => Promise<void>;
  users: UserProfile[];
  canReassign: boolean;
  canDelete: boolean;
  onDeleteTask?: (task: ProjectTask) => Promise<void>;
};

function TaskCardContent({ task, dragHandle, expanded = false }: { task: ProjectTask; dragHandle?: ReactNode; expanded?: boolean }) {
  const overdue = task.status !== "concluida" && task.due_date < todayIso();

  return (
    <>
      <div className="task-card-top">
        <span className="task-avatar">{initials(task.assignee_name)}</span>
        <div className="task-card-actions">
          {overdue ? <StatusPill tone="danger">Atrasada</StatusPill> : task.status === "concluida" ? <StatusPill tone="success">Concluída</StatusPill> : null}
          {dragHandle}
        </div>
      </div>
      <h4>{task.title}</h4>
      {expanded && task.description ? <p>{task.description}</p> : null}
      <div className={`task-meta ${task.status === "concluida" && !expanded ? "task-meta-completed" : ""}`}>
        {task.project_name ? <span><FolderKanban size={12} /> {task.project_name}</span> : null}
        <span><Users size={12} /> {task.assignee_name}</span>
        <span className={overdue ? "text-danger" : ""}><Calendar size={12} /> {dateBr(task.due_date)}</span>
      </div>
    </>
  );
}

function TaskCard({ task, disabled, onStatusChange, onTaskUpdate, users, canReassign, canDelete, onDeleteTask }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled,
    data: { status: task.status },
  });
  const style: CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scaleX}, ${transform.scaleY})` }
    : {};

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-card ${task.status === "concluida" ? "task-card-completed" : "task-card-collapsed"} ${expanded ? "task-card-expanded" : ""} ${task.status !== "concluida" && task.due_date < todayIso() ? "task-overdue" : ""} ${isDragging ? "task-card-dragging" : ""}`}
    >
      <TaskCardContent
        task={task}
        expanded={expanded}
        dragHandle={(
          <button
            type="button"
            className="task-drag-handle"
            aria-label={`Arrastar a tarefa ${task.title}`}
            title="Arrastar tarefa"
            disabled={disabled}
            {...listeners}
            {...attributes}
          >
            <GripVertical size={16} />
          </button>
        )}
      />
      {expanded ? <>
        <select
          value={task.status}
          onChange={(event) => void onStatusChange(task, event.target.value as TaskStatus)}
          aria-label={`Mudar status de ${task.title}`}
          disabled={disabled}
        >
          {TASK_COLUMNS.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
        </select>
        <div className="task-quick-fields">
          <label><span>Responsável</span><select value={task.assignee_user_id || ""} onChange={(event) => void onTaskUpdate(task, { assignee_user_id: event.target.value })} disabled={disabled || !canReassign}>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.full_name || user.email}</option>)}</select></label>
          <label><span>Prazo</span><input type="date" value={task.due_date} onChange={(event) => void onTaskUpdate(task, { due_date: event.target.value })} disabled={disabled} /></label>
        </div>
      </> : null}
      <div className="task-card-footer-actions">
        <button type="button" className="task-detail-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{expanded ? "Recolher" : "Detalhes"}</button>
        {canDelete && onDeleteTask ? <button type="button" className="task-delete-button" onClick={() => void onDeleteTask(task)} disabled={disabled} aria-label={`Excluir a tarefa ${task.title}`}><Trash2 size={14} /> Excluir</button> : null}
      </div>
    </article>
  );
}

function TaskColumn({
  status,
  label,
  tasks,
  movingTaskId,
  onStatusChange,
  onTaskUpdate,
  onAddTask,
  users,
  canAddTask,
  canReassign,
  canDelete,
  onDeleteTask,
}: {
  status: TaskStatus;
  label: string;
  tasks: ProjectTask[];
  movingTaskId: string | null;
  onStatusChange: (task: ProjectTask, status: TaskStatus) => Promise<void>;
  onTaskUpdate: (task: ProjectTask, updates: Partial<Pick<ProjectTask, "assignee_user_id" | "due_date">>) => Promise<void>;
  onAddTask: (status: TaskStatus) => void;
  users: UserProfile[];
  canAddTask: boolean;
  canReassign: boolean;
  canDelete: boolean;
  onDeleteTask?: (task: ProjectTask) => Promise<void>;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      className={`kanban-column column-${status} ${isOver ? "kanban-column-drop-target" : ""}`}
    >
      <header><div><span className="column-dot" /><h3>{label}</h3></div><strong>{tasks.length}</strong></header>
      <div className="kanban-tasks">
        {tasks.map((task) => <TaskCard task={task} disabled={Boolean(movingTaskId)} onStatusChange={onStatusChange} onTaskUpdate={onTaskUpdate} users={users} canReassign={canReassign} canDelete={canDelete} onDeleteTask={onDeleteTask} key={task.id} />)}
        {tasks.length === 0 ? <div className="column-empty">Solte uma tarefa aqui.</div> : null}
      </div>
      {canAddTask ? <button className="kanban-add" onClick={() => onAddTask(status)}><Plus size={15} /> Adicionar tarefa</button> : null}
    </section>
  );
}

export function ProjectTaskBoard({ tasks, movingTaskId, onStatusChange, onTaskUpdate, onAddTask, users, canAddTask = true, canReassign = true, canDelete = false, onDeleteTask }: ProjectTaskBoardProps) {
  const [activeTask, setActiveTask] = useState<ProjectTask | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const task = tasks.find((item) => item.id === event.active.id);
    const nextStatus = event.over?.id as TaskStatus | undefined;
    if (!task || !nextStatus || !TASK_COLUMNS.some((column) => column.key === nextStatus)) return;
    void onStatusChange(task, nextStatus);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => setActiveTask(tasks.find((item) => item.id === event.active.id) || null)}
      onDragCancel={() => setActiveTask(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-board">
        {TASK_COLUMNS.map((column) => (
          <TaskColumn
            status={column.key}
            label={column.label}
            tasks={tasks.filter((task) => task.status === column.key)}
            movingTaskId={movingTaskId}
            onStatusChange={onStatusChange}
            onTaskUpdate={onTaskUpdate}
            onAddTask={onAddTask}
            users={users}
            canAddTask={canAddTask}
            canReassign={canReassign}
            canDelete={canDelete}
            onDeleteTask={onDeleteTask}
            key={column.key}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>
        {activeTask ? <article className="task-card task-drag-overlay"><TaskCardContent task={activeTask} /></article> : null}
      </DragOverlay>
    </DndContext>
  );
}
