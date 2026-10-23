import { getSupabase } from "./supabase";
import {
  PAYMENT_BUCKET,
  PAYMENT_FILE_MAX,
  PAYMENT_FILE_TYPES,
} from "./payment-requests";
export async function paymentFetch(
  path: string,
  options: RequestInit & { anonymous?: boolean; retryRateLimit?: boolean } = {},
  trackingToken?: string,
) {
  const { anonymous, retryRateLimit, ...requestOptions } = options;
  const headers = new Headers(options.headers);
  if (trackingToken) headers.set("X-Payment-Token", trackingToken);
  else if (!anonymous) {
    const session = await getSupabase()?.auth.getSession();
    if (session?.data.session)
      headers.set(
        "Authorization",
        `Bearer ${session.data.session.access_token}`,
      );
  }
  if (options.body) headers.set("Content-Type", "application/json");
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(path, { ...requestOptions, headers, cache: "no-store" });
    // Upload routes reject 429 before creating/confirming a file. Retry only
    // that known rejection; never repeat an uncertain upload or another POST.
    if (!retryRateLimit || response.status !== 429 || attempt >= 3) break;
    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter)
      : retryAfter ? (Date.parse(retryAfter) - Date.now()) / 1000 : 61;
    const delay = Number.isFinite(seconds) ? Math.max(1, seconds) * 1000 : 61_000;
    if (delay > 5 * 60_000) break;
    await response.body?.cancel();
    await new Promise<void>(resolve => setTimeout(resolve, delay));
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error || "Não foi possível concluir. Tente novamente.",
    );
  return data;
}
export async function uploadPaymentFile(
  id: string,
  file: File,
  kind: "support" | "quote" | "receipt",
  token?: string,
) {
  if (!file.size || file.size > PAYMENT_FILE_MAX)
    throw new Error(`${file.name}: use arquivos de até 10 MB.`);
  if (!PAYMENT_FILE_TYPES.includes(file.type))
    throw new Error(
      `${file.name}: formato não permitido. Use PDF, JPG, PNG, WebP, Word ou Excel.`,
    );
  const db = getSupabase();
  if (!db) throw new Error("Conexão indisponível.");
  const prepared = await paymentFetch(
    `/api/payments/${id}/files`,
    {
      method: "POST",
      retryRateLimit: true,
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        mime_type: file.type,
        kind,
      }),
    },
    token,
  );
  if (file.size > 6 * 1024 * 1024) {
    const { Upload } = await import("tus-js-client");
    const endpoint = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    endpoint.hostname = endpoint.hostname.replace(/\.supabase\.(co|in|red)$/, ".storage.supabase.$1");
    endpoint.pathname = "/storage/v1/upload/resumable/sign";
    endpoint.search = "";
    endpoint.hash = "";
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint: endpoint.toString(),
        headers: { "x-signature": prepared.token },
        metadata: { bucketName: PAYMENT_BUCKET, objectName: prepared.path, contentType: file.type, cacheControl: "3600" },
        chunkSize: 6 * 1024 * 1024,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        uploadDataDuringCreation: true,
        // Tokens and tracking credentials stay out of persistent browser storage.
        storeFingerprintForResuming: false,
        onSuccess: () => resolve(),
        onError: () => reject(new Error(`Não foi possível enviar ${file.name}. Tente novamente.`)),
      });
      upload.start();
    });
  } else {
    const upload = await db.storage
      .from(PAYMENT_BUCKET)
      .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
    if (upload.error)
      throw new Error(`Não foi possível enviar ${file.name}. Tente novamente.`);
  }
  await paymentFetch(
    `/api/payments/${id}/files/${prepared.id}`,
    { method: "POST", retryRateLimit: true },
    token,
  );
}
