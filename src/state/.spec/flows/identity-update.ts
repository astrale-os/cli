import type { IdentityStore, IdentityUpdate } from '../api.js'

declare const withIdentityLock: <Value>(transition: () => Promise<Value>) => Promise<Value>
declare const readLatest: () => Promise<{
  readonly store: IdentityStore
}>
declare const publishV1: (store: IdentityStore) => Promise<void>

/** One V1 identity mutation rereads admitted state, transitions, then publishes exactly once. */
export function updateIdentity<Value>(
  transition: (current: IdentityStore) => IdentityUpdate<Value> | Promise<IdentityUpdate<Value>>,
): Promise<Value> {
  return withIdentityLock(async () => {
    const current = await readLatest()
    const update = await transition(current.store)
    await publishV1(update.next)
    return update.value
  })
}
