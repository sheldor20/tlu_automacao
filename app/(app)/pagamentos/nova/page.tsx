import Link from "next/link";
import { PaymentRequestForm } from "@/components/payment-request-form";
import { PageIntro } from "@/components/ui";
export default function NewPaymentPage() {
  return (
    <>
      <Link href="/pagamentos" className="payment-back">
        ← Solicitações de pagamento
      </Link>
      <PageIntro
        eyebrow="Financeiro"
        title="Nova solicitação"
        description="Escolha o tipo de pagamento e preencha os dados para análise."
      />
      <PaymentRequestForm />
    </>
  );
}
