export type CollectionGroupTotal = {
  collection_group: string;
  contracts: number | string;
  amount: number | string;
  promises: number | string;
  installments: number | string;
};

export type CollectionSummary = {
  contracts: number;
  amount: number;
  promises: number;
  installments: number;
};

export function normalizeCollectionQuery(query: string): string {
  return query.replace(/[^\p{L}\p{N} .-]/gu, "").trim();
}

// The response scope prevents old totals from appearing under new filters.
export function collectionFilterKey(query: string, company: string): string {
  return JSON.stringify([company, normalizeCollectionQuery(query)]);
}

export function summarizeCollectionGroups(
  totals: readonly CollectionGroupTotal[] | undefined,
  group: string,
): CollectionSummary {
  let cents = 0;
  const summary: CollectionSummary = {
    contracts: 0,
    amount: 0,
    promises: 0,
    installments: 0,
  };
  for (const total of totals || []) {
    // Match the worklist: "all" includes every overdue group, even review/judicial.
    if (group === "all" ? total.collection_group === "current" : total.collection_group !== group)
      continue;
    cents += Math.round(Number(total.amount) * 100);
    summary.contracts += Number(total.contracts);
    summary.promises += Number(total.promises);
    summary.installments += Number(total.installments);
  }
  summary.amount = cents / 100;
  return summary;
}
