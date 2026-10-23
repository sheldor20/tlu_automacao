import { z } from "zod";
import { distratoAccess } from "@/lib/distratos-server";
import { renderDistratoPdf } from "@/lib/distratos-pdf";
import { type DistratoDocument } from "@/lib/distratos";
import { checked } from "@/lib/operations-server";
import { paymentFailure, paymentJson, PaymentError } from "@/lib/payment-server";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await distratoAccess(request);
    const id = z.uuid().parse((await context.params).id);
    const document = await checked(db.from("distrato_documents").select("*").eq("id", id).maybeSingle()) as DistratoDocument | null;
    if (!document) throw new PaymentError("Distrato não encontrado.", 404);
    if (!new URL(request.url).searchParams.has("pdf")) return paymentJson({ document });
    return new Response(Buffer.from(renderDistratoPdf(document)), { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="distrato-${id}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return paymentFailure(error); }
}
