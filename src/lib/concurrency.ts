/**
 * Minimal bounded-concurrency map. No external dependency (the repo
 * hand-rolls with `Promise.all`); a tiny worker pool is enough for the
 * `domain dev up` fan-out.
 */

/**
 * Run `fn` over `items` with at most `limit` in flight at once. Results
 * are returned in input order regardless of completion order. The first
 * rejection rejects the returned promise and starts no further item;
 * in-flight work still settles.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  const bound = Math.max(1, Math.min(limit, items.length))
  let next = 0
  let failed = false

  async function worker(): Promise<void> {
    while (!failed) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i] as T, i)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  await Promise.all(Array.from({ length: bound }, () => worker()))
  return results
}
