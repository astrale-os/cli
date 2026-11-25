import { Path } from '@astrale-os/sdk/graph/path'
import { MutationAST } from '@astrale-os/sdk/mutation'
import { K } from '@astrale-os/sdk/schema'

import type { KernelCommandOpts } from '../../connection'
import type { CredentialIntent } from '../../connection/credential'

import { createPathCall } from '../../connection'
import { executionPending } from '../../connection/errors'
import { withClientSession, type ConnectionContext } from '../../connection/session'

/** The profiles a Shell gives an account: `workspace.member` opens the OS, `workspace.admin` runs it. */
export type ShellProfile = 'member' | 'admin'

const SHELL = 'shell.astrale.ai'
const shellPath = (kind: 'class' | 'core', name: string) =>
  Path.project({ origin: SHELL, kind, name } as never)
const CREATE_USER = Path.staticMethod(shellPath('class', 'User'), 'create').raw
const SEND_INVITATION = Path.staticMethod(shellPath('class', 'Invitation'), 'send').raw
const profileRole = (profile: ShellProfile) => shellPath('core', `workspace.${profile}`).raw

/** How long the command waits for the run to refuse at once before it reports the invitation sent. */
export const REFUSAL_WINDOW_MS = 15_000

/** What the instance's Shell did for one invitation. */
export interface InstanceInvitation {
  readonly instance: string
  readonly email: string
  /** The Shell account the invitation binds, on the instance. */
  readonly user: string
  /** The account was created now; otherwise the account of that email already existed. */
  readonly created: boolean
  /** The profile granted now; absent when the account existed and kept the profiles it had. */
  readonly profile?: ShellProfile
  /** The `Invitation.send` Execution: it keeps the invitation until sign-in, cancel or expiry. */
  readonly execution: string
  /** The UUIDv7 that created the account: rerun with it within one hour to resume. */
  readonly operation: string
}

/** The three calls an invitation takes on the instance, each one as the caller. */
export interface ShellInvitationSteps {
  createUser(input: {
    readonly operationId: string
    readonly email: string
    readonly name: string
  }): Promise<{ readonly user: string; readonly created: boolean }>
  grantProfile(user: string, profile: ShellProfile): Promise<void>
  /** Start `Invitation.send`; it settles only if the run ended (a refusal) within the window. */
  sendInvitation(user: string): Promise<{ readonly execution: string }>
}

export interface InviteOnInstanceInput {
  readonly instance: string
  readonly email: string
  readonly name?: string
  readonly profile?: ShellProfile
  /** A UUIDv7 of an earlier attempt, to recover the account it created. */
  readonly operation?: string
}

/**
 * Invite a person through the instance's own Shell, as the instance's console does: find or create
 * the account of the email, give a new account its profile, then start `Invitation.send`. The Shell
 * asks Admin to send the email (`/v1/invitations`) and records who asked: the caller's Identity.
 *
 * An account that already existed keeps its profiles: an administrator changes them in the console.
 */
export async function inviteOnInstance(
  steps: ShellInvitationSteps,
  input: InviteOnInstanceInput,
): Promise<InstanceInvitation> {
  const operation = input.operation ?? uuidv7()
  const name = input.name ?? defaultName(input.email)
  const { user, created } = await steps.createUser({
    operationId: operation,
    email: input.email,
    name,
  })
  const profile = created ? (input.profile ?? 'member') : undefined
  if (profile !== undefined) await steps.grantProfile(user, profile)
  const { execution } = await steps.sendInvitation(user)
  return {
    instance: input.instance,
    email: input.email,
    user,
    created,
    ...(profile === undefined ? {} : { profile }),
    execution,
    operation,
  }
}

/** The steps over sessions on the instance the options select, as the caller. */
export function shellInvitationSteps(opts: KernelCommandOpts): ShellInvitationSteps {
  const session = <Value>(
    credential: CredentialIntent,
    action: (context: ConnectionContext) => Promise<Value>,
  ) => withClientSession(opts, action, credential)
  const callable = (path: string) => ({ principal: 'callable', path: Path.parse(path) }) as const
  return {
    createUser: (input) =>
      session(callable(CREATE_USER), async ({ session }) => {
        const result = await session.dispatch(createPathCall(CREATE_USER, input))
        if (result.kind !== 'value') throw new TypeError('User.create did not answer a value.')
        return acceptCreated(result.value)
      }),
    grantProfile: (user, profile) =>
      // A graph write acts as the caller: the Kernel admits it for a granter of the Role.
      session({ principal: 'caller' }, async ({ graph }) => {
        await graph.mutate(
          MutationAST.create({
            operations: [
              {
                op: 'edge.create',
                class: K.classes.extends_with.key,
                source: user as never,
                target: profileRole(profile) as never,
                props: {},
              },
            ],
          }),
        )
      }),
    sendInvitation: (user) =>
      session(callable(SEND_INVITATION), async ({ session }) => {
        const result = await session.dispatch(createPathCall(SEND_INVITATION, { user }))
        if (result.kind !== 'execution') {
          throw new TypeError('Invitation.send did not start an Execution.')
        }
        const execution = result.execution
        // The run sends the email first, then waits days for the sign-in. A refusal (Admin's
        // conflict, an invalid address) ends it at once: wait that long to report it.
        try {
          await session.execution.result(execution, { waitMs: REFUSAL_WINDOW_MS })
        } catch (error) {
          if (!executionPending(error)) throw error
        }
        return { execution: String(execution) }
      }),
  }
}

function acceptCreated(value: unknown): { readonly user: string; readonly created: boolean } {
  const record = value as { readonly user?: unknown; readonly created?: unknown } | null
  if (
    record === null ||
    typeof record !== 'object' ||
    typeof record.user !== 'string' ||
    typeof record.created !== 'boolean'
  ) {
    throw new TypeError('User.create answered an unexpected value.')
  }
  Path.parse(record.user)
  return { user: record.user, created: record.created }
}

/** The name a new account shows until the person sets theirs: the email's local part. */
export function defaultName(email: string): string {
  const local = email.split('@')[0]?.trim() ?? ''
  return (local.length > 0 ? local : email).slice(0, 100)
}

/** A fresh UUIDv7 (RFC 9562): what `User.create` takes to recover the account it made. */
export function uuidv7(now = Date.now()): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  let time = BigInt(now)
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(time & 0xffn)
    time >>= 8n
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/** Admit an `--operation` value: the UUIDv7 an earlier attempt printed. */
export function acceptOperation(input: string): string {
  if (!UUIDV7.test(input))
    throw new TypeError('--operation must be the UUIDv7 an earlier attempt printed.')
  return input
}
