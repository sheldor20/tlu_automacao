import type { Project, ProjectTask } from "@/lib/types";

export function withProjectProgress(project: Project, tasks: ProjectTask[], today: string): Project {
  const projectTasks = tasks.filter((task) => task.project_id === project.id);
  const completedTasks = projectTasks.filter((task) => task.status === "concluida").length;
  const overdueTasks = projectTasks.filter(
    (task) => task.status !== "concluida" && task.due_date < today,
  ).length;

  return {
    ...project,
    total_tasks: projectTasks.length,
    completed_tasks: completedTasks,
    overdue_tasks: overdueTasks,
    progress_percent: projectTasks.length ? (completedTasks / projectTasks.length) * 100 : 0,
  };
}
