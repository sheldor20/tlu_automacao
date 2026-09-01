export function monthsThroughLastClosed<T extends { isCurrent: boolean }>(months: T[]) {
  const currentMonthIndex = months.findIndex((month) => month.isCurrent);
  return currentMonthIndex >= 0 ? months.slice(0, currentMonthIndex) : months;
}

export type ManagementMonth = {
  key: string;
  label: string;
  isCurrent: boolean;
};

export function previousClosedMonth(months: ManagementMonth[], year: number): ManagementMonth {
  const currentMonthIndex = months.findIndex((month) => month.isCurrent);
  if (currentMonthIndex > 0) return months[currentMonthIndex - 1];

  const date = new Date(year - 1, 11, 1, 12);
  return {
    key: `${year - 1}-12-01`,
    label: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", ""),
    isCurrent: false,
  };
}
