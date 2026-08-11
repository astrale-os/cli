import type { Identity, IdentityExport, IdentityImportOptions, IdentityStore } from '../api.js'

declare const withIdentityLock: <Value>(transition: () => Promise<Value>) => Promise<Value>
declare const readLatest: () => Promise<IdentityStore>
declare const checkImportConflict: (
  store: IdentityStore,
  envelope: IdentityExport,
  options: IdentityImportOptions,
) => string
declare const persistAdmittedKeypair: (envelope: IdentityExport) => Promise<void>
declare const publishIdentity: (
  store: IdentityStore,
  name: string,
  envelope: IdentityExport,
  options: IdentityImportOptions,
) => Promise<Identity>

/** Import performs all fallible admission before entering this ordered persistence flow. */
export function importIdentity(
  envelope: IdentityExport,
  options: IdentityImportOptions,
): Promise<Identity> {
  return withIdentityLock(async () => {
    const store = await readLatest()
    const name = checkImportConflict(store, envelope, options)
    await persistAdmittedKeypair(envelope)
    return publishIdentity(store, name, envelope, options)
  })
}
