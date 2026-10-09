import type { IssuerId } from '@astrale-os/sdk/auth'
import type { AuthApi } from '@astrale-os/sdk/auth'
import type { Call, GraphApi } from '@astrale-os/sdk/client'
import type { ClientSession } from '@astrale-os/sdk/client/session'
import type { Path } from '@astrale-os/sdk/graph/path'

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

/** Existing Admin-target overrides accepted by Admin Domain operations and Admin-targeted calls. */
export interface AdminConnectionOptions extends ConnectionOptions {
  readonly admin?: string
  readonly adminUrl?: string
  readonly domainIssuer?: string
}

/** The Admin kernel a command runs on: a bookmark, a URL with its Admin Domain issuer, or neither (the configured Admin target). */
export type AdminTargetSelection = Pick<
  AdminConnectionOptions,
  'admin' | 'adminUrl' | 'domainIssuer'
>

/** Exact source Kernel selected from flags and local CLI state. */
export interface ConnectionTarget {
  readonly url: string
  readonly issuer: IssuerId
  /** Exact Domain issuer; presence activates standard token exchange. */
  readonly domainIssuer?: IssuerId
  /**
   * Origin of the installed Domain the selected identity is exchanged through (the Shell for an
   * Astrale-managed Instance). The source Kernel's pin names its issuer; never set together with
   * `domainIssuer`, and its presence also activates standard token exchange.
   */
  readonly domainOrigin?: string
  readonly slug?: string
  readonly defaultIdentity?: string
  readonly caFile?: string
}

/**
 * Whose authority a connection presents: the target's exchange Domain (default), the caller
 * itself, or a callable's declaring Domain read from the source Kernel's installation.
 */
export type CredentialIntent =
  | Readonly<{ principal?: 'domain'; nestedTtlSeconds?: never }>
  | Readonly<{ principal: 'caller'; nestedTtlSeconds?: number }>
  | Readonly<{ principal: 'callable'; path: Path; nestedTtlSeconds?: never }>

/** Stable local identity-registration key for the exact selected source Kernel. */
export function registrationKeyForTarget(target: ConnectionTarget): string

/**
 * The options of an Admin session opened beside a command's own target: the Admin selection, the
 * caller's identity (--as) and the session settings. Never -i/--url, --creds or --anonymous, which
 * select and authenticate that target.
 */
export function adminSessionOptions(options: AdminConnectionOptions): AdminConnectionOptions

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

/**
 * Resolve the configured Admin Domain target under the same scoped lifecycle. A callable
 * credential selects the callable's declaring Domain from the Admin kernel's installation.
 */
export function withAdminClientSession<Value>(
  options: AdminConnectionOptions,
  action: (context: ConnectionContext) => Promise<Value>,
  credential?: CredentialIntent,
): Promise<Value>

/** Expand @self through the effective principal returned by authenticated Identity.whoami. */
export function expandSelfInPath(
  path: string,
  context: ConnectionContext,
): Promise<{ readonly path: string; readonly meta?: SelfExpansionMeta }>

/** Expand @self once across one Call path and its CLI-authored string parameters. */
export function expandSelfInCall(
  path: string,
  parameters: Readonly<Record<string, unknown>>,
  context: ConnectionContext,
): Promise<{
  readonly path: string
  readonly parameters: Readonly<Record<string, unknown>>
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
  /** Run on the Admin kernel, selected like `domain` Admin commands select it, not -i/--url/active. */
  readonly admin?: AdminTargetSelection
  readonly credential?: CredentialIntent
  readonly fn: (context: ConnectionContext) => Promise<Value>
  readonly format?: (
    result: Value,
    options: KernelCommandOpts,
    machine: boolean,
  ) => void | Promise<void>
}): Promise<void>
