type DatabaseResult = { error: { message: string; code?: string } | null };

// Only use for idempotent writes: a disconnected response can hide a committed write.
export async function retryImportWrite<T extends DatabaseResult>(
  operation: () => PromiseLike<T>,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const result = await operation();
    if (
      !result.error ||
      attempt >= 4 ||
      !(
        /^(PGRST00[0-3]|40001|40P01|53\d\d\d|57P0[1-3]|08\d\d\d)$/.test(
          result.error.code || "",
        ) ||
        /schema cache|connection|fetch failed|network|temporarily unavailable/i.test(
          result.error.message,
        )
      )
    )
      return result;
    await wait(1000 * 2 ** attempt);
  }
}
