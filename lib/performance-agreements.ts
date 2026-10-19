import { z } from "zod";

const date = z.iso.date();
export const performanceGoalSchema = z.object({
  title: z.string().trim().min(1, "Informe a meta.").max(300),
  indicator: z.string().trim().min(1, "Informe o indicador.").max(500),
  expected_result: z.string().trim().min(1, "Informe o resultado esperado.").max(1000),
  due_date: date,
});

export const performanceAgreementSchema = z.object({
  report_user_id: z.uuid(),
  cycle: z.string().trim().min(1, "Informe o ciclo.").max(120),
  starts_on: date,
  ends_on: date,
  expectations: z.string().trim().max(10000),
  goals: z.array(performanceGoalSchema).min(1, "Cadastre pelo menos uma meta.").max(30),
}).superRefine((value, context) => {
  if (value.ends_on < value.starts_on) {
    context.addIssue({ code: "custom", path: ["ends_on"], message: "O término deve ser igual ou posterior ao início do ciclo." });
  }
  value.goals.forEach((goal, index) => {
    if (goal.due_date < value.starts_on || goal.due_date > value.ends_on) {
      context.addIssue({ code: "custom", path: ["goals", index, "due_date"], message: `O prazo da meta ${index + 1} deve estar dentro do ciclo.` });
    }
  });
});

export type PerformanceGoal = z.infer<typeof performanceGoalSchema>;
export type PerformanceAgreementInput = z.infer<typeof performanceAgreementSchema>;
export type PerformanceAgreement = PerformanceAgreementInput & {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export function emptyPerformanceGoal(): PerformanceGoal {
  return { title: "", indicator: "", expected_result: "", due_date: "" };
}

export function performanceAgreementError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
  if (message.includes("performance_agreements_cycle_key")) return "Já existe um acordo para este colaborador e ciclo. Abra o registro existente para editar.";
  if (message.includes("performance_agreement_conflict")) return "O acordo foi alterado por outra pessoa ou seu acesso mudou. Recarregue os acordos antes de editar novamente.";
  if (message.includes("performance_agreement_invalid")) return "Revise o ciclo, o período e as metas. Os prazos precisam estar dentro do ciclo.";
  if (message.includes("row-level security") || message.includes("permission denied")) return "Você não tem mais acesso a este acordo. Recarregue a página.";
  return "Não foi possível salvar o acordo. Seus dados continuam no formulário; tente novamente.";
}

export type PerformanceAcknowledgment = {
  id: string; agreement_id: string; agreement_version: number; signer_id: string;
  signature_name: string; signed_at: string; statement: string; snapshot: PerformanceAgreement;
};
