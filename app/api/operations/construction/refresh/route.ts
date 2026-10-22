import { after } from "next/server";
import { operationsAccess } from "@/lib/operations-server";
import { paymentFailure, paymentJson, PaymentError } from "@/lib/payment-server";
import { syncQlikOperations } from "@/lib/qlik-operations-sync";

export const maxDuration = 800;

export async function POST(request: Request) {
  try {
    const { actor } = await operationsAccess(request, ["obras"], true);
    if (!actor.admin) throw new PaymentError("Somente administradores podem sincronizar a origem Qlik.", 403);
    after(async () => {
      for (const kind of ["paid", "payable"] as const) {
        for (let attempt = 0; attempt < 12; attempt++) {
          const response = await syncQlikOperations(kind);
          const result = await response.json();
          if (response.status === 409 || result.paused) break;
          if (!result.partial && !result.retry) break;
        }
      }
    });
    return paymentJson({ started: true });
  } catch (error) { return paymentFailure(error); }
}
