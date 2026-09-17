import { BudgetPlanner } from "@/components/budget-planner";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Planejador orçamentário · Terra Lótus",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <BudgetPlanner />;
}
