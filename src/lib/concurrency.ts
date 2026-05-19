/**
 * Minimal bounded-concurrency map. No external dependency (the repo
 * hand-rolls with `Promise.all`); a tiny worker pool is enough for the
 * `domain dev up` fan-out.
 */

/**
 * Run `fn` over `items` with at most `limit` in flight at once. Results
 * are returned in input order regardless of completion order. The first
 * rejection rejects the returned promise (in-flight work still settles).
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  const bound = Math.max(1, Math.min(limit, items.length))
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i] as T, i)
    }
  }

  await Promise.all(Array.from({ length: bound }, () => worker()))
  return results
}
