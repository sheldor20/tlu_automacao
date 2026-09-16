import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CLOSED_PAYMENT_STATUSES,
  PAYMENT_BUCKET,
  PAYMENT_FILE_MAX,
  PAYMENT_FILE_TYPES,
} from "@/lib/payment-requests";
import {
  PaymentError,
  paymentAccess,
  paymentBody,
  paymentDb,
  paymentFailure,
  paymentJson,
  paymentLimit,
} from "@/lib/payment-server";
const fileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  size: z.number().int().min(1).max(PAYMENT_FILE_MAX),
  mime_type: z
    .string()
    .refine(
      (t) => PAYMENT_FILE_TYPES.includes(t),
      "Use PDF, imagem, Word ou Excel.",
    ),
  kind: z.enum(["support", "quote", "receipt"]),
});
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = paymentDb(),
      { id } = await params;
    const { actor, record } = await paymentAccess(request, db, id);
    if (CLOSED_PAYMENT_STATUSES.includes(record.status))
      throw new PaymentError("Esta solicitação já foi encerrada.", 409);
    const file = fileSchema.parse(await paymentBody(request));
    if (file.kind === "receipt" && !actor?.manager)
      throw new PaymentError(
        "Somente a gestão pode anexar comprovantes de pagamento.",
        403,
      );
    await paymentLimit(db, `files:${id}`, 40, 3600);
    const extension: Record<string, string> = {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      [PAYMENT_FILE_TYPES[4]]: "docx",
      [PAYMENT_FILE_TYPES[5]]: "xlsx",
    };
    const fileId = randomUUID(),
      path = `${id}/${fileId}.${extension[file.mime_type]}`;
    const { error } = await db
      .from("payment_request_files")
      .insert({
        ...file,
        id: fileId,
        request_id: id,
        path,
        uploaded_by: actor?.id || null,
      });
    if (error) throw error;
    const signed = await db.storage
      .from(PAYMENT_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (signed.error) {
      await db.from("payment_request_files").delete().eq("id", fileId);
      throw signed.error;
    }
    return paymentJson({ id: fileId, path, token: signed.data.token });
  } catch (error) {
    return paymentFailure(error);
  }
}
