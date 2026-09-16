import type { SupabaseClient } from "@supabase/supabase-js";

export const TASK_FILE_BUCKET = "task-files";
export const TASK_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const TASK_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", zip: "application/zip",
};
export const TASK_FILE_ACCEPT = Object.keys(TASK_FILE_TYPES).map((extension) => `.${extension}`).join(",");

export type TaskActivity = {
  id: string;
  task_id: string;
  kind: "comment" | "file";
  body: string | null;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  content_type: string | null;
  author_id: string | null;
  author_name: string;
  created_at: string;
};

export function taskFileType(file: Pick<File, "name" | "size">) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!TASK_FILE_TYPES[extension]) throw new Error(`O formato de “${file.name}” não é permitido. Use documentos, imagens, planilhas, apresentações ou ZIP.`);
  if (file.size <= 0) throw new Error(`O arquivo “${file.name}” está vazio.`);
  if (file.size > TASK_FILE_MAX_BYTES) throw new Error(`O arquivo “${file.name}” excede o limite de 20 MB.`);
  if (file.name.length > 255) throw new Error("Use um nome de arquivo com até 255 caracteres.");
  return { extension, contentType: TASK_FILE_TYPES[extension] };
}

export function taskFileSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.ceil(size / 1024))} KB` : `${(size / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

// A stable ID lets a retry recover a successful insert after a lost response.
export async function insertTaskActivity(client: SupabaseClient, input: {
  id: string; task_id: string; kind: TaskActivity["kind"];
  body?: string; file_path?: string; file_name?: string;
}): Promise<TaskActivity> {
  const result = await client.from("project_task_activity").insert(input).select().single();
  if (!result.error) return result.data as TaskActivity;
  const existing = await client.from("project_task_activity").select().eq("id", input.id).eq("task_id", input.task_id).maybeSingle();
  if (existing.data) return existing.data as TaskActivity;
  throw result.error;
}

export async function uploadTaskFile(client: SupabaseClient, taskId: string, file: File): Promise<TaskActivity> {
  const { extension, contentType } = taskFileType(file);
  const id = crypto.randomUUID();
  const path = `${taskId}/files/${id}.${extension}`;
  const { error } = await client.storage.from(TASK_FILE_BUCKET).upload(path, file, { contentType, upsert: false });
  if (error) throw error;
  try {
    return await insertTaskActivity(client, { id, task_id: taskId, kind: "file", file_path: path, file_name: file.name });
  } catch (error) {
    // Storage only permits removing files that do not have a recorded activity.
    await client.storage.from(TASK_FILE_BUCKET).remove([path]);
    throw error;
  }
}

export async function downloadTaskFile(client: SupabaseClient, activity: TaskActivity) {
  if (!activity.file_path || !activity.file_name) return;
  const { data, error } = await client.storage.from(TASK_FILE_BUCKET).createSignedUrl(activity.file_path, 60, { download: activity.file_name });
  if (error) throw error;
  const link = document.createElement("a");
  link.href = data.signedUrl;
  link.download = activity.file_name;
  link.rel = "noopener";
  link.click();
}
