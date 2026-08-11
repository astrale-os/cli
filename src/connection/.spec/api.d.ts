import type { AuthApi } from '@astrale-os/kernel-client/auth'
import type { GraphApi } from '@astrale-os/kernel-client/graph'
import type { HostSession } from '@astrale-os/kernel-client/host'
import type { IssuerId } from '@astrale-os/kernel-core/auth'

/** Existing CLI connection flags accepted by Kernel-touching commands. */
export interface ConnectionOptions {
  readonly url?: string
  readonly instance?: string
  readonly timeout?: string
  readonly as?: string
  readonly creds?: string
}

/** Existing Admin-target overrides accepted only by Admin Domain operations. */
export interface AdminConnectionOptions extends ConnectionOptions {
  readonly admin?: string
  readonly adminUrl?: string
}

/** Exact source Kernel selected from flags and local CLI state. */
export interface ConnectionTarget {
  readonly url: string
  readonly issuer: IssuerId
  readonly slug?: string
  readonly defaultIdentity?: string
  readonly caFile?: string
}

/** Narrow capabilities available during one scoped CLI connection. */
export interface ConnectionContext {
  readonly host: HostSession
  readonly graph: GraphApi
  readonly auth: AuthApi
  readonly target: ConnectionTarget
}

/** Create the Node Fetch adapter used by bookmarks that select a private HTTPS CA. */
export function fetchWithCaFile(caFile: string, fallback?: typeof fetch): typeof fetch

/** Resolve one ordinary CLI target, run an action, and close every owned Client resource. */
export function withHostSession<Value>(
  options: ConnectionOptions,
  action: (context: ConnectionContext) => Promise<Value>,
): Promise<Value>

/** Resolve the configured Admin Domain target under the same scoped lifecycle. */
export function withAdminHostSession<Value>(
  options: AdminConnectionOptions,
  action: (context: ConnectionContext) => Promise<Value>,
): Promise<Value>
