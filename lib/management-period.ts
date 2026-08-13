export function monthsThroughLastClosed<T extends { isCurrent: boolean }>(months: T[]) {
  const currentMonthIndex = months.findIndex((month) => month.isCurrent);
  return currentMonthIndex >= 0 ? months.slice(0, currentMonthIndex) : months;
}
