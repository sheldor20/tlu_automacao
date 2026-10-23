import { BusinessOrigin } from "@/components/business-origin";

export default async function BusinessOriginPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BusinessOrigin id={id} />;
}
