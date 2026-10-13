import type { IdentityStore } from '../../identity'

import { removeKeypair } from '../../keys'
import { ExchangeCredentialCache, SESSION_ROUTE_STORE, updateIdentityStore } from '../../state'

export interface InstanceRootCleanup {
  readonly name: string
  readonly status: 'absent' | 'removed' | 'retained' | 'error'
  readonly reason?: string
  readonly keyRetained?: boolean
}

type IdentityRemoval =
  | { readonly status: 'absent' | 'retained'; readonly reason?: string }
  | { readonly status: 'removed'; readonly subject: string }

/** Match both the deleted Kernel and the identity observed before the remote deletion. */
export async function removeDeletedInstanceRootIdentity(
  target: { readonly slug: string; readonly issuer?: string },
  before: IdentityStore,
): Promise<InstanceRootCleanup> {
  const name = `${target.slug}-root`
  try {
    const removed = await updateIdentityStore<IdentityRemoval>((store) => {
      const entry = store.identities[name]
      const expected = before.identities[name]
      let reason: string | undefined
      if (entry?.source === 'idp') reason = 'The identity is IdP-backed.'
      else if (entry && (!target.issuer || entry.issuer !== target.issuer))
        reason = 'The identity does not name the deleted Kernel issuer.'
      else if (
        entry &&
        (!expected ||
          expected.source !== entry.source ||
          expected.issuer !== entry.issuer ||
          expected.subject !== entry.subject ||
          expected.kid !== entry.kid)
      )
        reason = 'The identity changed during deletion.'

      if (!entry || reason) {
        return {
          next: store,
          value: { status: entry ? ('retained' as const) : ('absent' as const), reason },
        }
      }
      const { [name]: _, ...identities } = store.identities
      return {
        next: {
          ...store,
          identities,
          default: store.default === name ? (Object.keys(identities)[0] ?? '') : store.default,
        },
        value: { status: 'removed' as const, subject: entry.subject },
      }
    })
    if (removed.status !== 'removed') return { name, ...removed }

    // Commit the registry first: a failed registry write must not strand an identity
    // without its key. Recheck references under the lock before touching shared keys.
    const keyRetained = await updateIdentityStore(async (store) => {
      const referenced = Object.values(store.identities).some(
        (identity) => identity.source !== 'idp' && identity.subject === removed.subject,
      )
      if (!referenced) await removeKeypair(removed.subject)
      return { next: store, value: referenced }
    })
    await new ExchangeCredentialCache().clear()
    SESSION_ROUTE_STORE.clear()
    return { name, status: 'removed', keyRetained }
  } catch {
    return {
      name,
      status: 'error',
      reason:
        'Local root cleanup failed. Inspect the identity store and key files before removing them manually.',
    }
  }
}
