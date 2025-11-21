export async function batchRun<T>(
  items: T[],
  worker: (item: T, idx: number) => Promise<void>,
  { concurrency = 2, delayMs = 1200 }: { concurrency?: number; delayMs?: number } = {},
) {
  const total = items.length;
  if (!total) return;

  const runnerCount = Math.max(1, Math.min(concurrency, total));
  let idx = 0;

  const runner = async () => {
    while (idx < total) {
      const current = idx++;
      await worker(items[current], current);
      if (delayMs && idx < total) {
        await sleep(delayMs);
      }
    }
  };

  const runners = Array.from({ length: runnerCount }, () => runner());
  await Promise.all(runners);
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
