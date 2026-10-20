import { ContractDetail } from "@/components/contract-detail";
import { PublicPaymentShell } from "@/components/public-payment-shell";
export const metadata = { title: "Acompanhar contrato | Terra Lótus", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function ContractTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  return <PublicPaymentShell><ContractDetail token={(await params).token} /></PublicPaymentShell>;
}
