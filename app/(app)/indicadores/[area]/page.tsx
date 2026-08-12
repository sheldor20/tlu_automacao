"use client";

import { ManagementDashboard } from "@/components/management-dashboard";
import type { ManagementAreaSlug } from "@/lib/types";
import { useParams } from "next/navigation";

export default function ManagementAreaPage() {
  const params = useParams<{ area: string }>();
  return <ManagementDashboard area={params.area as ManagementAreaSlug} />;
}
