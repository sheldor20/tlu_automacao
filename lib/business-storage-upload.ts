import type { SupabaseClient } from "@supabase/supabase-js";
import { Upload } from "tus-js-client";

const RESUMABLE_UPLOAD_THRESHOLD = 6 * 1024 * 1024;
const RESUMABLE_CHUNK_SIZE = 6 * 1024 * 1024;

export function resumableStorageEndpoint(supabaseUrl: string) {
  const endpoint = new URL(supabaseUrl);
  if (/\.supabase\.(co|in|red)$/.test(endpoint.hostname)) {
    endpoint.hostname = endpoint.hostname.replace(/\.supabase\.(co|in|red)$/, ".storage.supabase.$1");
  }
  endpoint.pathname = "/storage/v1/upload/resumable";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

export async function uploadBusinessStorageFile({
  supabase,
  filePath,
  file,
  mimeType,
  onProgress,
}: {
  supabase: SupabaseClient;
  filePath: string;
  file: File;
  mimeType: string;
  onProgress?(percentage: number): void;
}) {
  if (file.size <= RESUMABLE_UPLOAD_THRESHOLD) {
    const uploadBody = file.type === mimeType ? file : new Blob([file], { type: mimeType });
    const { error } = await supabase.storage.from("business-files").upload(filePath, uploadBody, {
      contentType: mimeType,
      upsert: false,
    });
    if (error) throw error;
    onProgress?.(100);
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("A conexão com o armazenamento não está disponível.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Sua sessão expirou. Entre novamente.");

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: resumableStorageEndpoint(supabaseUrl),
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      headers: {
        authorization: `Bearer ${data.session.access_token}`,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "business-files",
        objectName: filePath,
        contentType: mimeType,
        cacheControl: "3600",
      },
      chunkSize: RESUMABLE_CHUNK_SIZE,
      onError: reject,
      onProgress: (bytesUploaded, bytesTotal) => {
        onProgress?.(bytesTotal > 0 ? (bytesUploaded / bytesTotal) * 100 : 0);
      },
      onSuccess: () => resolve(),
    });

    void upload.findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length > 0) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      })
      .catch(reject);
  });
}
