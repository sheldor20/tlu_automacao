import { PaymentRequestForm } from "@/components/payment-request-form";
import { PublicPaymentShell } from "@/components/public-payment-shell";
export const metadata = {
  title: "Solicitações | Terra Lótus",
  robots: { index: false, follow: false },
};
export default function PublicPaymentPage() {
  return (
    <PublicPaymentShell>
      <div className="payment-public-intro">
        <span className="eyebrow">Financeiro</span>
        <h1>Solicitações</h1>
        <p>
          Envie sua solicitação de pagamento ou contrato e guarde o link
          de acompanhamento exibido após o envio.
        </p>
      </div>
      <PaymentRequestForm publicForm />
    </PublicPaymentShell>
  );
}
