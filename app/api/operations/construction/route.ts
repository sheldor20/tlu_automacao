import { z } from "zod";
import { operationsAccess, allRows, checked } from "@/lib/operations-server";
import {
  paymentBody,
  paymentFailure,
  paymentJson,
  PaymentError,
} from "@/lib/payment-server";
import {
  constructionLinkSchema,
  constructionWorkKeys,
  inheritedLinkMatches,
  MANUAL_FINANCE_DISABLED,
  monthlyConstructionExpenses,
  type FinanceSources,
  type MonthlyCashEntry,
} from "@/lib/construction-finance";

export async function GET(request: Request) {
  try {
    const { db, service, canWrite } = await operationsAccess(request, [
      "obras",
    ]);
    const id = z.uuid().parse(new URL(request.url).searchParams.get("id"));
    const work = await checked(
      db
        .from("constructions")
        .select(
          "id,name,source_business_id,qlik_work_key,qlik_additional_work_keys,updated_at",
        )
        .eq("id", id)
        .single(),
    );
    const workKeys = constructionWorkKeys(work);
    const connection = await checked(
      service
        .from("data_connections")
        .select("active,settings")
        .eq("slug", "qlik-operations")
        .single(),
    );
    const [
      commitments,
      estimate,
      entries,
      stages,
      stageBudgets,
      linkedWorks,
      runs,
    ] = await Promise.all([
      allRows(db, "construction_commitments", "*", { construction_id: id }),
      checked(
        db
          .from("construction_cost_estimates")
          .select("*")
          .eq("construction_id", id)
          .maybeSingle(),
      ),
      workKeys.length
        ? allRows(
            db,
            "operational_cash_entries",
            "id,work_key,kind,cash_date,amount,active",
            {
              work_key: workKeys,
              active: true,
              kind: ["paid", "payable"],
            },
          )
        : Promise.resolve([]),
      allRows(db, "construction_macro_stages", "id,name", {
        construction_id: id,
      }),
      allRows(db, "construction_stage_finances", "*", { construction_id: id }),
      workKeys.length
        ? allRows(
            db,
            "qlik_works",
            "key,company_id,work_id,name,active,qlik_companies(name)",
            { key: workKeys },
          )
        : Promise.resolve([]),
      // One latest run per source, so a busy importer cannot hide another source's state.
      Promise.all(
        ["paid", "payable"].map(async (kind) => ({
          kind,
          run: await checked(
            service
              .from("operational_imports")
              .select("status")
              .eq("kind", kind)
              .order("started_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ),
        })),
      ),
    ]);
    // Pagination must not combine two different published snapshots.
    const after = await checked(
      service
        .from("data_connections")
        .select("settings")
        .eq("slug", "qlik-operations")
        .single(),
    );
    if (
      ["paid", "payable"].some(
        (kind) =>
          connection.settings?.[kind]?.at !== after.settings?.[kind]?.at,
      )
    )
      throw new PaymentError(
        "Uma nova carga Qlik foi publicada durante a consulta. Recarregue os dados.",
        409,
      );
    const sources = Object.fromEntries(
      runs.map(({ kind, run }) => [
        kind,
        {
          at: connection.settings?.[kind]?.at || null,
          status: run?.status || "pending",
        },
      ]),
    ) as FinanceSources;
    return paymentJson({
      work,
      workKeys,
      linkedWorks,
      commitments,
      estimate,
      stageBudgets,
      stages,
      monthly: monthlyConstructionExpenses(
        entries as MonthlyCashEntry[],
        workKeys,
        sources,
      ),
      sources,
      syncActive: connection.active,
      checkedAt: new Date().toISOString(),
      canWrite,
    });
  } catch (e) {
    return paymentFailure(e);
  }
}

export async function POST(request: Request) {
  try {
    const { db } = await operationsAccess(request, ["obras"], true);
    const body = await paymentBody(request);
    // Old clients must not be able to submit financial values after the UI changes.
    if (body?.action !== "link")
      throw new PaymentError(MANUAL_FINANCE_DISABLED, 405);
    const b = constructionLinkSchema.parse(body);
    const work = await checked(
      db
        .from("constructions")
        .select("id,source_business_id,qlik_work_key,updated_at")
        .eq("id", b.id)
        .single(),
    );
    if (
      work.source_business_id &&
      !inheritedLinkMatches(work.qlik_work_key, b.work_keys)
    ) {
      throw new PaymentError(
        "O vínculo principal é herdado do negócio de origem. Altere-o em Novos Negócios antes de selecionar unidades adicionais nesta obra.",
        409,
      );
    }
    if (b.work_keys.length) {
      const available = await allRows(db, "qlik_works", "key", {
        key: b.work_keys,
        active: true,
      });
      if (available.length !== b.work_keys.length)
        throw new PaymentError(
          "Selecione apenas unidades ativas disponíveis no catálogo Qlik.",
          422,
        );
    }
    // One atomic update under the caller's existing RLS; no service-role write.
    let update = db
      .from("constructions")
      .update({
        qlik_work_key: b.work_keys[0] || null,
        qlik_additional_work_keys: b.work_keys.slice(1),
      })
      .eq("id", b.id)
      .eq("updated_at", b.expected_updated_at);
    update = work.source_business_id
      ? update.eq("source_business_id", work.source_business_id)
      : update.is("source_business_id", null);
    const saved = await checked(update.select("id").maybeSingle());
    if (!saved)
      throw new PaymentError(
        "A obra mudou ou você não pode editá-la. Recarregue antes de confirmar o vínculo.",
        409,
      );
    return paymentJson({ ok: true });
  } catch (e) {
    return paymentFailure(e);
  }
}
