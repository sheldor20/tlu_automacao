import {
  paymentActor,
  paymentDb,
  paymentFailure,
  paymentJson,
  PaymentError,
} from "@/lib/payment-server";
export async function POST(request: Request) {
  try {
    const db = paymentDb(),
      actor = (await paymentActor(request, db))!;
    const p = await db
      .from("announcement_publishers")
      .select("user_id")
      .eq("user_id", actor.id)
      .maybeSingle();
    if (p.error) throw p.error;
    if (!actor.admin && !p.data)
      throw new PaymentError("Publicação não autorizada.", 403);
    if (Number(request.headers.get("content-length")) > 4_200_000)
      throw new PaymentError("Use uma imagem de até 4 MB.", 413);
    const form = await request.formData(),
      file = form.get("file");
    if (!(file instanceof File) || file.size > 4_000_000 || !file.size)
      throw new PaymentError("Use uma imagem de até 4 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const head = Array.from(bytes.slice(0, 12));
    const text = new TextDecoder().decode(bytes.slice(0, 12));
    const ext =
      head[0] === 255 && head[1] === 216 && head[2] === 255
        ? "jpg"
        : head.slice(0, 8).join() === "137,80,78,71,13,10,26,10"
          ? "png"
          : text.startsWith("GIF87a") || text.startsWith("GIF89a")
            ? "gif"
            : text.startsWith("RIFF") && text.slice(8) === "WEBP"
              ? "webp"
              : null;
    if (!ext)
      throw new PaymentError("Formato permitido: JPG, PNG, WebP ou GIF.");
    const path = `${actor.id}/${crypto.randomUUID()}.${ext}`;
    const result = await db.storage
      .from("announcement-media")
      .upload(path, bytes, {
        contentType: ext === "jpg" ? "image/jpeg" : `image/${ext}`,
        upsert: false,
      });
    if (result.error) throw result.error;
    return paymentJson({ path });
  } catch (e) {
    return paymentFailure(e);
  }
}
