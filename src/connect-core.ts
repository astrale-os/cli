/**
 * connect-core — the frozen, curated re-export surface the connect-host adapter
 * borrows from the CLI. It is the ONE public seam between `@astrale-os/cli` and
 * `@astrale-os/connect-host`; nothing else in cli/src is contract.
 *
 * Consumed by `@astrale-os/connect-host`; temps-2 seed of a future
 * `@astrale-os/client-core`. Re-export ONLY — no logic lives here.
 */

// ── identity registry (~/.astrale/identities.json) ──────────────────────────
export { readIdentities, getDefault, getIdentity } from './lib/identity'
export type { Identity, IdentityStore } from './lib/identity'

// ── keypairs on disk + self-grant mint ──────────────────────────────────────
export { signAs, listIdentityKeys } from './lib/keys'

// ── instance bookmarks (~/.astrale/instances.json) ──────────────────────────
export {
  readInstances,
  resetInstancesMemo,
  resolveInstance,
  normalizeInstanceKernelUrl,
  orgIdForAudience,
} from './lib/instance'
export type { InstanceEntry, InstanceStore, ResolvedInstance } from './lib/instance'

// ── instance-target resolution (bookmark | managed | admin | free url) ──────
export { resolveInstanceTarget } from './lib/instance-target'
export type { ResolvedInstanceTarget } from './lib/instance-target'

// ── global config (~/.astrale/config.json) ──────────────────────────────────
export { readConfig } from './lib/config'
export type { AstraleConfig } from './lib/config'

// ── credential resolution (self-grant + IdP) ────────────────────────────────
export { resolveCredential, IdpRefreshTransientError, IdpOrgMembershipError } from './kernel/auth'

// ── IdP login (device flow) — driven by connect-host's `auth.login` op ───────
export { loginViaIdp, resolveIdpName } from './lib/login-flow'
export type { LoginFlowOpts, LoginResult, DeviceVerification } from './lib/login-flow'

// ── IdP session state (so connect-host can flag "login required" rows) ───────
export { readIdpSession, isSessionExpired } from './lib/idp'
export type { IdpSession } from './lib/idp'

// ── typed errors ────────────────────────────────────────────────────────────
export { AuthError } from './errors'

// ── custom-CA fetch (private-CA local stacks) ───────────────────────────────
export { fetchWithCaFile } from './kernel/ca-fetch'

// ── path resolution (~/.astrale layout) ─────────────────────────────────────
export { paths, createPaths } from './lib/env'
