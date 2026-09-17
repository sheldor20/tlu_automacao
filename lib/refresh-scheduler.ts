// Browser focus and visibilitychange often arrive together. Coalesce the burst
// and serialize refreshes, retaining one follow-up if data changes in flight.
export function createRefreshScheduler(refresh: () => Promise<unknown>, delay = 100) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;
  let disposed = false;

  const run = async () => {
    timer = undefined;
    if (disposed) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await refresh();
    } finally {
      running = false;
      if (pending && !disposed) {
        pending = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  };
  return {
    schedule,
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
