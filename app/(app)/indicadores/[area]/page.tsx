"use client";

import { ManagementDashboardRefresh } from "@/components/management-dashboard-refresh";
import type { ManagementIndicatorArea } from "@/lib/indicator-refresh";
import { useParams } from "next/navigation";

export default function ManagementAreaPage() {
  const params = useParams<{ area: string }>();
  return <ManagementDashboardRefresh area={params.area as ManagementIndicatorArea} />;
}
