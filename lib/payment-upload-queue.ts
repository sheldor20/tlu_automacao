export type UploadProgress = { completed: number; total: number };

// Bound both network traffic and simultaneous server-side file validation.
export async function runPaymentUploads<T>(
  files: readonly T[],
  upload: (file: T) => Promise<void>,
  onProgress: (progress: UploadProgress) => void,
) {
  const failures = new Map<number, string>();
  let next = 0;
  let completed = 0;
  onProgress({ completed, total: files.length });
  async function worker() {
    while (next < files.length) {
      const index = next++;
      try {
        await upload(files[index]);
      } catch (error) {
        failures.set(index, error instanceof Error ? error.message : "Falha no anexo.");
      } finally {
        onProgress({ completed: ++completed, total: files.length });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
  return {
    pending: files.filter((_, index) => failures.has(index)),
    errors: [...failures.entries()].sort(([a], [b]) => a - b).map(([, message]) => message),
  };
}

export function appendPaymentFiles(current: File[], added: File[]) {
  const result = [...current];
  for (const file of added) {
    if (!result.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified && item.type === file.type)) result.push(file);
  }
  return result;
}
