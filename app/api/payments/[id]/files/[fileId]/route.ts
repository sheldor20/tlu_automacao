import { after } from "next/server";
import { PAYMENT_BUCKET, PAYMENT_FILE_MAX } from "@/lib/payment-requests";
import {
  PaymentError,
  paymentAccess,
  paymentDb,
  paymentFailure,
  paymentJson,
} from "@/lib/payment-server";
import { dispatchPaymentEmails } from "@/lib/payment-email";
type Context = { params: Promise<{ id: string; fileId: string }> };
export const maxDuration = 240;
async function contextFor(request: Request, context: Context) {
  const { id, fileId } = await context.params,
    db = paymentDb();
  const access = await paymentAccess(request, db, id);
  const { data: file, error } = await db
    .from("payment_request_files")
    .select("*")
    .eq("id", fileId)
    .eq("request_id", id)
    .maybeSingle();
  if (error) throw error;
  if (!file) throw new PaymentError("Arquivo não encontrado.", 404);
  return { db, file, ...access };
}
export async function GET(request: Request, context: Context) {
  try {
    const { db, file } = await contextFor(request, context);
    if (!file.ready)
      throw new PaymentError(
        "O envio do arquivo ainda não foi concluído.",
        409,
      );
    const { data, error } = await db.storage
      .from(PAYMENT_BUCKET)
      .createSignedUrl(file.path, 60, { download: file.name });
    if (error) throw error;
    return paymentJson({ url: data.signedUrl });
  } catch (error) {
    return paymentFailure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const { db, file, actor, tokenHash } = await contextFor(request, context);
    if (file.kind === "receipt" && !actor?.manager)
      throw new PaymentError("Acesso restrito à gestão.", 403);
    if (file.ready) return paymentJson({ ok: true });
    const info = await db.storage.from(PAYMENT_BUCKET).info(file.path);
    if (info.error)
      throw new PaymentError(
        "Arquivo ainda não recebido. Tente enviar novamente.",
        409,
      );
    if (
      typeof info.data.size !== "number" ||
      info.data.size !== file.size ||
      info.data.size > PAYMENT_FILE_MAX ||
      info.data.contentType !== file.mime_type
    ) {
      await db.storage.from(PAYMENT_BUCKET).remove([file.path]);
      throw new PaymentError(
        "O arquivo recebido não corresponde ao tamanho ou formato informado.",
        422,
      );
    }
    const download = await db.storage.from(PAYMENT_BUCKET).download(file.path);
    if (download.error) throw download.error;
    const bytes = new Uint8Array(
      await download.data.slice(0, 12).arrayBuffer(),
    );
    const prefix = new TextDecoder().decode(bytes);
    const valid =
      file.mime_type === "application/pdf"
        ? prefix.startsWith("%PDF-")
        : file.mime_type === "image/png"
          ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
          : file.mime_type === "image/jpeg"
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : file.mime_type === "image/webp"
              ? prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP"
              : bytes[0] === 80 &&
                bytes[1] === 75 &&
                bytes[2] === 3 &&
                bytes[3] === 4;
    if (!valid) {
      await db.storage.from(PAYMENT_BUCKET).remove([file.path]);
      throw new PaymentError(
        "O conteúdo do arquivo não corresponde ao formato permitido.",
        422,
      );
    }
    const { error } = await db.rpc("complete_payment_file", {
      p_file_id: file.id,
      p_actor: actor?.id || null,
      p_token_hash: tokenHash,
    });
    if (error) throw error;
    after(async () => {
      try {
        await dispatchPaymentEmails();
      } catch {
        console.error("Payment notifications remain queued");
      }
    });
    return paymentJson({ ok: true });
  } catch (error) {
    return paymentFailure(error);
  }
}
