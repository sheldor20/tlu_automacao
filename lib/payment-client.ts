import { getSupabase } from "./supabase";
import {
  PAYMENT_BUCKET,
  PAYMENT_FILE_MAX,
  PAYMENT_FILE_TYPES,
} from "./payment-requests";
export async function paymentFetch(
  path: string,
  options: RequestInit & { anonymous?: boolean } = {},
  trackingToken?: string,
) {
  const { anonymous, ...requestOptions } = options;
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
  const response = await fetch(path, {
    ...requestOptions,
    headers,
    cache: "no-store",
  });
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
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        mime_type: file.type,
        kind,
      }),
    },
    token,
  );
  const upload = await db.storage
    .from(PAYMENT_BUCKET)
    .uploadToSignedUrl(prepared.path, prepared.token, file, {
      contentType: file.type,
    });
  if (upload.error)
    throw new Error(`Não foi possível enviar ${file.name}. Tente novamente.`);
  await paymentFetch(
    `/api/payments/${id}/files/${prepared.id}`,
    { method: "POST" },
    token,
  );
}
