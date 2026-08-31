import type { ProjectCategory, ProjectTask } from "@/lib/types";
import type { ProjectTaskDraft } from "@/components/project-task-editor";

export const PROJECT_TASK_RELATIONS = "assignees:project_task_assignees(task_id,user_id,assignee_name,assignee_email),subtasks:project_subtasks(id,task_id,title,position,completed_at,created_at,updated_at,assignees:project_subtask_assignees(subtask_id,user_id,assignee_name,assignee_email))";

export function emptyProjectTaskDraft(projectId: string, dueDate: string, status: ProjectTask["status"] = "a_fazer", assigneeIds: string[] = []): ProjectTaskDraft {
  return { project_id: projectId, title: "", description: "", due_date: dueDate, status, assignee_user_ids: assigneeIds, subtasks: [] };
}

export function projectTaskRpcPayload(form: ProjectTaskDraft, category: ProjectCategory) {
  return {
    p_task_id: form.id || null,
    p_project_id: form.project_id || null,
    p_category: category,
    p_title: form.title.trim(),
    p_description: form.description.trim() || null,
    p_due_date: form.due_date,
    p_status: form.status,
    p_assignee_ids: form.assignee_user_ids,
    p_subtasks: form.subtasks.map((subtask, position) => ({
      id: subtask.id || null,
      title: subtask.title.trim(),
      completed: subtask.completed,
      position,
      assignee_user_ids: subtask.assignee_user_ids,
    })),
  };
}
