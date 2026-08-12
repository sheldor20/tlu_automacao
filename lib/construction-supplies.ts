import type { ConstructionSupply } from "@/lib/types";

function safeQuantity(value: number) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
}

export function remainingSupplyQuantity(supply: ConstructionSupply) {
  const total = safeQuantity(supply.total_quantity);
  const used = Math.min(total, safeQuantity(supply.used_quantity));
  return Math.max(0, total - used);
}

export function supplyWithRemainingQuantity(supply: ConstructionSupply, remainingQuantity: number) {
  const total = safeQuantity(supply.total_quantity);
  const remaining = Math.min(total, safeQuantity(remainingQuantity));
  return {
    ...supply,
    total_quantity: total,
    used_quantity: Math.max(0, total - remaining),
  };
}
