import { PaymentDetail } from "@/components/payment-detail";
export default async function PaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PaymentDetail id={id} />;
}
