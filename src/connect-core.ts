/**
 * Curated connection surface for repository-owned host and operator tooling.
 * Keep this file as re-exports only: CLI state, authentication, and connection
 * owners remain authoritative, and Kernel implementation types stay private.
 */

export { getDefault, getIdentity, readIdentities } from './identity/registry'
export type { Identity, IdentityStore } from './identity/registry'

export { listIdentityKeys, signAs } from './keys/index'

export {
  normalizeInstanceKernelUrl,
  orgIdForAudience,
  readInstances,
  resetInstancesMemo,
  resolveInstance,
} from './lib/instance'
export type { InstanceEntry, InstanceStore, ResolvedInstance } from './lib/instance'

export { resolveInstanceTarget } from './lib/instance-target'
export type { ResolvedInstanceTarget } from './lib/instance-target'

export { readConfig } from './lib/config'
export type { AstraleConfig } from './lib/config'

export {
  IdpOrgMembershipError,
  IdpRefreshTransientError,
  resolveCredential,
} from './connection/auth'

export { withAdminClientSession } from './connection/session'
export type { ConnectionContext } from './connection/session'
export type { AdminConnectionOptions } from './connection/target'

export { loginViaIdp, resolveIdpName } from './lib/login-flow'
export type { DeviceVerification, LoginFlowOpts, LoginResult } from './lib/login-flow'

export { isSessionExpired, readIdpSession } from './lib/idp'
export type { IdpSession } from './lib/idp'

export { AuthError } from './errors'
export { fetchWithCaFile } from './lib/ca-fetch'

export { createPaths, paths } from './state/index'
