import type { ConstructionSupply } from "@/lib/types";

export type PublicWorkMicro = {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  progress_percent: number;
  supplies: ConstructionSupply[];
  updated_at: string;
};

export type PublicWorkStage = {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  progress_percent: number;
  micro_stages: PublicWorkMicro[];
};

export type PublicWorkConstruction = {
  id: string;
  name: string;
  address: string | null;
  status: string;
  progress_percent: number;
  updated_at: string;
};

export type PublicWorkSnapshot = {
  construction: PublicWorkConstruction;
  stages: PublicWorkStage[];
};

export type PendingPublicWorkSubmission = {
  id: string;
  token: string;
  micro_stage_id: string;
  micro_stage_name: string;
  progress_percent: number;
  note: string;
  supplies: ConstructionSupply[];
  photo: Blob;
  photo_name: string;
  photo_type: string;
  base_updated_at: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
  requires_review: boolean;
};

export type PublicWorkSubmissionResult = {
  ok: true;
  duplicate?: boolean;
  micro_stage_updated_at?: string;
};

type SnapshotRecord = {
  token: string;
  payload: PublicWorkSnapshot;
  cached_at: string;
};

const DATABASE_NAME = "terra-lotus-public-work";
const DATABASE_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const SUBMISSION_STORE = "submissions";
const MAX_PHOTO_DIMENSION = 2048;
const COMPRESSION_THRESHOLD = 2 * 1024 * 1024;

export const PUBLIC_WORK_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PUBLIC_WORK_SYNC_TAG = "public-work-updates";

export class PublicWorkSubmissionError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "PublicWorkSubmissionError";
    this.status = status;
    this.code = code;
  }
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao acessar os dados offline."));
  });
}

function transactionFinished(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("A operação offline foi cancelada."));
    transaction.onerror = () => reject(transaction.error || new Error("Falha ao salvar os dados offline."));
  });
}

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Este navegador não oferece armazenamento offline."));
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: "token" });
      }
      if (!database.objectStoreNames.contains(SUBMISSION_STORE)) {
        const submissions = database.createObjectStore(SUBMISSION_STORE, { keyPath: "id" });
        submissions.createIndex("token", "token", { unique: false });
        submissions.createIndex("created_at", "created_at", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Não foi possível preparar o modo offline."));
    request.onblocked = () => reject(new Error("Feche outras abas desta obra para ativar o modo offline."));
  });
}

export async function savePublicWorkSnapshot(token: string, payload: PublicWorkSnapshot) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).put({ token, payload, cached_at: new Date().toISOString() } satisfies SnapshotRecord);
    await transactionFinished(transaction);
  } finally {
    database.close();
  }
}

export async function getPublicWorkSnapshot(token: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, "readonly");
    const record = await requestResult(transaction.objectStore(SNAPSHOT_STORE).get(token) as IDBRequest<SnapshotRecord | undefined>);
    return record?.payload || null;
  } finally {
    database.close();
  }
}

export async function putPendingPublicWorkSubmission(submission: PendingPublicWorkSubmission) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUBMISSION_STORE, "readwrite");
    transaction.objectStore(SUBMISSION_STORE).put(submission);
    await transactionFinished(transaction);
  } finally {
    database.close();
  }
}

export async function listPendingPublicWorkSubmissions(token: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUBMISSION_STORE, "readonly");
    const records = await requestResult(
      transaction.objectStore(SUBMISSION_STORE).index("token").getAll(IDBKeyRange.only(token)) as IDBRequest<PendingPublicWorkSubmission[]>,
    );
    return records.sort((left, right) => left.created_at.localeCompare(right.created_at));
  } finally {
    database.close();
  }
}

export async function removePendingPublicWorkSubmission(id: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUBMISSION_STORE, "readwrite");
    transaction.objectStore(SUBMISSION_STORE).delete(id);
    await transactionFinished(transaction);
  } finally {
    database.close();
  }
}

export async function clearPublicWorkOfflineData(token: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([SNAPSHOT_STORE, SUBMISSION_STORE], "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).delete(token);
    const submissionStore = transaction.objectStore(SUBMISSION_STORE);
    const ids = await requestResult(submissionStore.index("token").getAllKeys(IDBKeyRange.only(token)));
    ids.forEach((id) => submissionStore.delete(id));
    await transactionFinished(transaction);
  } finally {
    database.close();
  }
}

export function applySubmissionToSnapshot(snapshot: PublicWorkSnapshot, submission: PendingPublicWorkSubmission): PublicWorkSnapshot {
  return {
    construction: snapshot.construction,
    stages: snapshot.stages.map((stage) => ({
      ...stage,
      micro_stages: stage.micro_stages.map((micro) => micro.id === submission.micro_stage_id ? {
        ...micro,
        progress_percent: submission.progress_percent,
        supplies: submission.supplies.map((supply) => ({ ...supply })),
      } : micro),
    })),
  };
}

export function isRetryablePublicWorkStatus(status: number) {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function buildPublicWorkSubmissionFormData(submission: PendingPublicWorkSubmission) {
  const body = new FormData();
  body.set("client_submission_id", submission.id);
  body.set("micro_stage_id", submission.micro_stage_id);
  body.set("progress_percent", String(submission.progress_percent));
  body.set("note", submission.note);
  body.set("supplies", JSON.stringify(submission.supplies));
  body.set("base_updated_at", submission.base_updated_at);
  body.set("photo", submission.photo, submission.photo_name);
  return body;
}

export async function sendPublicWorkSubmission(submission: PendingPublicWorkSubmission) {
  let response: Response;
  try {
    response = await fetch(`/api/public/obras/${submission.token}`, {
      method: "POST",
      body: buildPublicWorkSubmissionFormData(submission),
    });
  } catch {
    throw new PublicWorkSubmissionError("Sem conexão com o servidor.", 0, "NETWORK_ERROR");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new PublicWorkSubmissionError(
      result.error || "Não foi possível sincronizar a atualização.",
      response.status,
      typeof result.code === "string" ? result.code : null,
    );
  }
  return result as PublicWorkSubmissionResult;
}

function imageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Não foi possível preparar a foto."));
    };
    image.src = objectUrl;
  });
}

export async function compressPublicWorkPhoto(file: File) {
  if (file.size <= COMPRESSION_THRESHOLD) return file;
  try {
    const image = await imageFromFile(file);
    const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export function normalizedPublicWorkPhotoName(file: File, blob: Blob) {
  if (blob.type !== "image/jpeg" || file.type === "image/jpeg") return file.name.slice(0, 240);
  const baseName = file.name.replace(/\.[^.]+$/, "").slice(0, 230) || "foto-obra";
  return `${baseName}.jpg`;
}
