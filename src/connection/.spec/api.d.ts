import type { Call } from '@astrale-os/kernel-client'
import type { AuthApi } from '@astrale-os/kernel-client/auth'
import type { GraphApi } from '@astrale-os/kernel-client/graph'
import type { ClientSession } from '@astrale-os/kernel-client/session'
import type { IssuerId } from '@astrale-os/sdk/auth'

/** Existing CLI connection flags accepted by Kernel-touching commands. */
export interface ConnectionOptions {
  readonly url?: string
  readonly instance?: string
  readonly timeout?: string
  readonly as?: string
  readonly creds?: string
  /** Omit caller credentials even when local or bookmark defaults exist. */
  readonly anonymous?: boolean
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

/** Stable local identity-registration key for the exact selected source Kernel. */
export function registrationKeyForTarget(target: ConnectionTarget): string

/** Narrow capabilities available during one scoped CLI connection. */
export interface ConnectionContext {
  readonly session: ClientSession
  readonly graph: GraphApi
  readonly auth: AuthApi
  readonly target: ConnectionTarget
}

/** Existing output and diagnostic flags shared by commands that open a Kernel connection. */
export interface KernelCommandOpts extends ConnectionOptions {
  readonly raw?: boolean
  readonly json?: boolean
  readonly format?: 'yaml' | 'json'
  readonly debug?: boolean
}

/** Detached metadata used only to improve an error after a caller-authored @self expansion. */
export interface SelfExpansionMeta {
  readonly original: string
  readonly expanded: string
  readonly selfId: string
  readonly slug?: string
}

/** Parse caller-authored path text and retain one portable input in the public Call shape. */
export function createPathCall(path: string, input: unknown): Call

/** Resolve one ordinary CLI target, run an action, and close every owned Client resource. */
export function withClientSession<Value>(
  options: ConnectionOptions,
  action: (context: ConnectionContext) => Promise<Value>,
): Promise<Value>

/** Resolve the configured Admin Domain target under the same scoped lifecycle. */
export function withAdminClientSession<Value>(
  options: AdminConnectionOptions,
  action: (context: ConnectionContext) => Promise<Value>,
): Promise<Value>

/** Expand @self through the effective principal returned by authenticated Identity.whoami. */
export function expandSelfInPath(
  path: string,
  options: KernelCommandOpts,
): Promise<{ readonly path: string; readonly meta?: SelfExpansionMeta }>

/** Expand @self once across one Call path and its CLI-authored string parameters. */
export function expandSelfInCall(
  path: string,
  parameters: readonly string[],
  options: KernelCommandOpts,
): Promise<{
  readonly path: string
  readonly parameters: readonly string[]
  readonly meta?: SelfExpansionMeta
}>

/** Preserve stale-registration evidence while an expanded request is executed. */
export function withSelfHint<Value>(
  action: () => Promise<Value>,
  meta: SelfExpansionMeta | undefined,
): Promise<Value>

/** Run one command through the canonical progress, connection, presentation, and error boundary. */
export function runKernelCommand<Value>(input: {
  readonly opts: KernelCommandOpts
  readonly label: string
  readonly fn: (context: ConnectionContext) => Promise<Value>
  readonly format?: (
    result: Value,
    options: KernelCommandOpts,
    machine: boolean,
  ) => void | Promise<void>
}): Promise<void>
