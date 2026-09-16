import { PaymentRequestForm } from "@/components/payment-request-form";
import { PublicPaymentShell } from "@/components/public-payment-shell";
export const metadata = {
  title: "Solicitar pagamento | Terra Lótus",
  robots: { index: false, follow: false },
};
export default function PublicPaymentPage() {
  return (
    <PublicPaymentShell>
      <div className="payment-public-intro">
        <span className="eyebrow">Financeiro</span>
        <h1>Solicitar pagamento</h1>
        <p>
          Envie sua solicitação e acompanhe as atualizações pelo e-mail
          informado.
        </p>
      </div>
      <PaymentRequestForm publicForm />
    </PublicPaymentShell>
  );
}
