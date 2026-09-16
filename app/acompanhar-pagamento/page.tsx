import { PublicPaymentShell } from "@/components/public-payment-shell";
import { PaymentTracking } from "@/components/payment-tracking";
export const metadata = {
  title: "Acompanhar pagamento | Terra Lótus",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function TrackingPage() {
  return (
    <PublicPaymentShell>
      <PaymentTracking />
    </PublicPaymentShell>
  );
}
