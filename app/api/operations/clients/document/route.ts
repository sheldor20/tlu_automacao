import { z } from "zod";
import { operationsAccess, checked } from "@/lib/operations-server";
import {
  paymentFailure,
  paymentJson,
  PaymentError,
} from "@/lib/payment-server";
export async function GET(request: Request) {
  try {
    const { db, service } = await operationsAccess(request, [
      "clientes",
      "cobranca",
    ]);
    const id = z.uuid().parse(new URL(request.url).searchParams.get("id"));
    const event = await checked(
      db.from("client_events").select("file_path").eq("id", id).single(),
    );
    if (!event.file_path)
      throw new PaymentError("Documento não encontrado.", 404);
    const url = await checked(
      service.storage
        .from("client-documents")
        .createSignedUrl(event.file_path, 60),
    );
    return paymentJson({ url: url.signedUrl });
  } catch (e) {
    return paymentFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const { service, actor } = await operationsAccess(
      request,
      ["clientes"],
      true,
    );
    if (Number(request.headers.get("content-length") || 0) > 4.2 * 1024 * 1024)
      throw new PaymentError("O limite é 4 MB.", 413);
    const form = await request.formData();
    const client = z.string().min(1).max(500).parse(form.get("client_id"));
    const contract = String(form.get("contract_id") || "") || null;
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size > 4 * 1024 * 1024 ||
      file.size === 0
    )
      throw new PaymentError("Selecione um documento de até 4 MB.");
    await checked(
      service.from("client_accounts").select("id").eq("id", client).single(),
    );
    if (contract) {
      const c = await checked(
        service
          .from("client_contracts")
          .select("client_id")
          .eq("id", contract)
          .single(),
      );
      if (c.client_id !== client)
        throw new PaymentError("Contrato não pertence a este cliente.");
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    let ext = "";
    if (bytes.subarray(0, 5).toString() === "%PDF-") ext = "pdf";
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      ext = "jpg";
    else if (
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      ext = "png";
    if (!ext) throw new PaymentError("Use PDF, JPG ou PNG.");
    const mime =
      ext === "pdf"
        ? "application/pdf"
        : ext === "jpg"
          ? "image/jpeg"
          : "image/png";
    const path = `${crypto.randomUUID()}/${crypto.randomUUID()}.${ext}`;
    await checked(
      service.storage
        .from("client-documents")
        .upload(path, bytes, { contentType: mime, upsert: false }),
    );
    const record = await service
      .from("client_events")
      .insert({
        client_id: client,
        contract_id: contract,
        kind: "document",
        title: file.name.slice(0, 300),
        file_name: file.name.slice(0, 300),
        file_path: path,
        status: "completed",
        created_by: actor.id,
      });
    if (record.error) {
      await service.storage.from("client-documents").remove([path]);
      throw record.error;
    }
    return paymentJson({ ok: true });
  } catch (e) {
    return paymentFailure(e);
  }
}
