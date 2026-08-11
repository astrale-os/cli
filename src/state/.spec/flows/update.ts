import type { FileLockOptions } from '../api.js'

declare const readLatest: <Value>(path: string) => Promise<Value>
declare const prepare: <Value>(current: Value) => Promise<Value>
declare const atomicWrite: (path: string, data: string) => Promise<void>
declare const withFileLock: <Value>(
  lockPath: string,
  transition: () => Promise<Value>,
  options?: FileLockOptions,
) => Promise<Value>

/** Every semantic registry rereads and replaces its latest durable value while holding one lock. */
export function update<Value>(
  path: string,
  encode: (value: Value) => string,
  options?: FileLockOptions,
): Promise<Value> {
  return withFileLock(
    `${path}.lock`,
    async () => {
      const current = await readLatest<Value>(path)
      const next = await prepare(current)
      await atomicWrite(path, encode(next))
      return next
    },
    options,
  )
}
