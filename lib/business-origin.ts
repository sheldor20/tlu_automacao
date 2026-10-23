import { BUSINESS_PORTFOLIO_SECTIONS, BUSINESS_STAGES, businessPortfolioSectionForStage } from "./constants.ts";

export function businessOriginDestination(id: string, stage: string): string | null {
  const known = BUSINESS_STAGES.find(item => item.key === stage);
  if (!known) return null;
  const section = businessPortfolioSectionForStage(known.key);
  const path = BUSINESS_PORTFOLIO_SECTIONS.find(item => item.key === section)!.href;
  return `${path}?business=${encodeURIComponent(id)}`;
}
