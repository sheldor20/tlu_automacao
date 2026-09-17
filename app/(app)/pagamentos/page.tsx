import { PaymentList } from "@/components/payment-list";
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  const { scope } = await searchParams;
  const initialScope = scope === "management" ? "management" : "mine";
  return <PaymentList key={initialScope} initialScope={initialScope} />;
}
