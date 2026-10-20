import Link from "next/link";
import { PaymentRequestForm } from "@/components/payment-request-form";
import { PageIntro } from "@/components/ui";
export default function NewPaymentPage() {
  return (
    <>
      <Link href="/pagamentos" className="payment-back">
        ← Solicitações
      </Link>
      <PageIntro
        eyebrow="Financeiro"
        title="Nova solicitação"
        description="Escolha o que você precisa solicitar e preencha os dados para análise."
      />
      <PaymentRequestForm />
    </>
  );
}
