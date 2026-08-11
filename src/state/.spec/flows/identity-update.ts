import type { IdentityStore, IdentityUpdate } from '../api.js'

declare const withIdentityLock: <Value>(transition: () => Promise<Value>) => Promise<Value>
declare const readLatest: () => Promise<{
  readonly store: IdentityStore
  readonly legacyBytes?: string
}>
declare const preserveLegacyBackup: (bytes: string) => Promise<void>
declare const publishV1: (store: IdentityStore) => Promise<void>

/** One identity mutation rereads, transitions, backs up legacy bytes, then publishes exactly once. */
export function updateIdentity<Value>(
  transition: (current: IdentityStore) => IdentityUpdate<Value> | Promise<IdentityUpdate<Value>>,
): Promise<Value> {
  return withIdentityLock(async () => {
    const current = await readLatest()
    const update = await transition(current.store)
    if (current.legacyBytes !== undefined) await preserveLegacyBackup(current.legacyBytes)
    await publishV1(update.next)
    return update.value
  })
}
