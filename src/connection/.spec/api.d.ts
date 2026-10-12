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
  readonly ci?: boolean
}

/** Existing Admin-target overrides accepted by Admin Domain operations and Admin-targeted calls. */
export interface AdminConnectionOptions extends ConnectionOptions {
  readonly fleet?: string
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
  readonly kernelIssuer: IssuerId
  /** Exact Domain issuer; presence activates standard token exchange, absence acts for the identity. */
  readonly domainIssuer?: IssuerId
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
  /** Resolve the selected identity before any Domain credential exchange. */
  readonly self: () => Promise<{ readonly id: string }>
  readonly target: ConnectionTarget
  /** Local identity label selected for this session; absent for raw credentials or anonymous use. */
  readonly identity?: string
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
  credential?: CredentialIntent,
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

/** The operation a failed command may have applied, and the same command with a fresh one. */
export interface OperationRecovery {
  readonly operation: string
  /** The same command without `--operation`: a fresh operation, a new attempt. */
  readonly fresh: string
  /** The flags that select the same Instance and identity, for the commands that follow an Execution. */
  readonly target?: readonly string[]
}

/** Exit status of a result read whose Execution is still running: try again later (EX_TEMPFAIL). */
export const TRY_LATER_EXIT: 75

/** The Execution a result read is for, and the commands that follow it once it is still running. */
export interface PendingFollowUp {
  readonly execution: string
  /** The command that waits for its outcome. */
  readonly follow: string
  /** The command that reads its status. */
  readonly observe: string
  /** Whether this read waited (`--wait-ms`) before the Kernel answered that it has not ended. */
  readonly waited: boolean
}

/** The flags that select the same Instance and identity, for a command that follows this one. */
export function targetFlags(
  opts: Pick<ConnectionOptions, 'url' | 'instance' | 'as'>,
): readonly string[]

/** Run one command through the canonical progress, connection, presentation, and error boundary. */
export function runKernelCommand<Value>(input: {
  readonly opts: KernelCommandOpts
  readonly label: string
  /** Run on the Admin kernel, selected like `domain` Admin commands select it, not -i/--url/active. */
  readonly admin?: AdminTargetSelection
  readonly credential?: CredentialIntent
  /**
   * A result read: an Execution that has not ended is no failure but a neutral "still running",
   * the commands that follow it, and exit {@link TRY_LATER_EXIT}.
   */
  readonly pending?: PendingFollowUp
  readonly fn: (context: ConnectionContext) => Promise<Value>
  readonly format?: (
    result: Value,
    options: KernelCommandOpts,
    machine: boolean,
  ) => void | Promise<void>
}): Promise<void>
