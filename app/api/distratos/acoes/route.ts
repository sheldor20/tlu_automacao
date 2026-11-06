import { randomUUID } from "node:crypto";
import { distratoAccess } from "@/lib/distratos-server";
import { allRows, checked } from "@/lib/operations-server";
import { legalActionCreate, legalActionUpdate } from "@/lib/distrato-legal-actions";
import { paymentBody, paymentFailure, paymentJson, PaymentError } from "@/lib/payment-server";

const table = "distrato_legal_actions";
const columns = "id,protocol,details,status,observations,revision,updated_at";

export async function GET(request: Request) {
  try {
    const { db, canWrite } = await distratoAccess(request);
    const actions = await allRows(db, table, columns);
    return paymentJson({ actions, canWrite });
  } catch (error) {
    return paymentFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, actor } = await distratoAccess(request, true);
    const input = legalActionCreate.parse(await paymentBody(request));
    const saved = await db.from(table).insert({ ...input, created_by: actor.id, updated_by: actor.id }).select(columns).single();
    if (saved.error?.code === "23505") {
      const previous = await checked(db.from(table).select(`${columns},created_by`).eq("id", input.id).maybeSingle());
      if (previous?.created_by === actor.id && previous.protocol === input.protocol &&
          Object.entries(input.details).every(([key, value]) => previous.details[key] === value)) {
        const { created_by: _creator, ...action } = previous;
        return paymentJson({ action });
      }
      throw new PaymentError("Já existe uma ação cadastrada com esse número de processo.", 409);
    }
    if (saved.error) throw saved.error;
    return paymentJson({ action: saved.data }, 201);
  } catch (error) {
    return paymentFailure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { db, actor } = await distratoAccess(request, true);
    const { id, revision, ...tracking } = legalActionUpdate.parse(await paymentBody(request));
    const action = await checked(db.from(table)
      .update({ ...tracking, updated_by: actor.id, revision: randomUUID(), updated_at: new Date().toISOString() })
      .eq("id", id).eq("revision", revision).select(columns).maybeSingle());
    if (!action) throw new PaymentError("A ação foi alterada em outra sessão. Recarregue a página para consultar a versão atual.", 409);
    return paymentJson({ action });
  } catch (error) {
    return paymentFailure(error);
  }
}
