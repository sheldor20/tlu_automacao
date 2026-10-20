import { ContractDetail } from "@/components/contract-detail";
export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  return <ContractDetail id={(await params).id} />;
}
