import type { Input, Result } from '@astrale-os/kernel-client'
import type {
  ClientSession,
  SessionRequestOptions,
  SessionSnapshot,
} from '@astrale-os/kernel-client/session'
import type {
  Definition,
  Domain as RichDomain,
  InstanceMethod,
  StaticMethod,
} from '@astrale-os/sdk/domain'
import type { PathLike } from '@astrale-os/sdk/graph/path'
import type { Key } from '@astrale-os/sdk/schema'

import { call } from '@astrale-os/kernel-client'
import * as sessionModule from '@astrale-os/kernel-client/session'
import { Domain } from '@astrale-os/sdk/domain'
import { Path } from '@astrale-os/sdk/graph/path'

const ADMIN_ORIGIN = 'admin.astrale.ai'

type DynamicCallable =
  | (Definition<'function'> & { readonly path: NonNullable<Definition<'function'>['path']> })
  | StaticMethod
  | InstanceMethod

export interface AdminBindingOperations {
  readonly installation: unknown
  readonly publication: SessionSnapshot['publication']
  invoke(
    callable: DynamicCallable,
    receiverOrInput: PathLike | Input,
    inputOrOptions?: Input | SessionRequestOptions,
    options?: SessionRequestOptions,
  ): Promise<unknown>
}

export type AdminBinding = RichDomain & {
  readonly $: RichDomain['$'] & AdminBindingOperations
}

interface CompatibleCallableReference {
  readonly origin: typeof ADMIN_ORIGIN
  readonly revision: SessionSnapshot['publication']['schema']['revision']
  readonly callable: Key.Callable
  readonly target: PathLike
  readonly outputMode: DynamicCallable['definition']['output']['mode']
}

interface CompatibleSession {
  readonly installation?: (origin: typeof ADMIN_ORIGIN) => Promise<unknown>
  readonly installed?: (origin: typeof ADMIN_ORIGIN) => Promise<unknown>
  readonly invoke?: (
    reference: CompatibleCallableReference,
    input: Input,
    options?: SessionRequestOptions,
  ) => Promise<unknown>
}

type LegacyDispatchBound = (
  session: ClientSession,
  request: ReturnType<typeof call>,
  expected: {
    readonly schema: { readonly revision: CompatibleCallableReference['revision'] }
    readonly publication: {
      readonly origin: SessionSnapshot['publication']['origin']
      readonly identity: SessionSnapshot['publication']['identity']
      readonly revision: CompatibleCallableReference['revision']
      readonly etag: SessionSnapshot['publication']['etag']
    }
  },
  options?: SessionRequestOptions,
) => Promise<Result>

/** Bind the Admin revision advertised by this exact Session snapshot. */
export async function bindAdmin(session: ClientSession): Promise<AdminBinding> {
  const snapshot = await session.snapshot()
  if (
    snapshot.publication.origin !== ADMIN_ORIGIN ||
    snapshot.bundle.root.origin !== ADMIN_ORIGIN
  ) {
    throw new TypeError('Configured Admin target does not serve the Admin Domain.')
  }
  const compatible = session as unknown as CompatibleSession
  const resolveInstallation = compatible.installation ?? compatible.installed
  if (resolveInstallation === undefined) {
    throw new TypeError('Client Session cannot resolve an installed Admin Domain.')
  }
  const installation = await resolveInstallation.call(session, ADMIN_ORIGIN)
  const domain = Domain.fromSchema(snapshot.bundle.root)
  const invoke = ((
    callable: DynamicCallable,
    receiverOrInput: PathLike | Input,
    inputOrOptions?: Input | SessionRequestOptions,
    options?: SessionRequestOptions,
  ) => {
    const target =
      'on' in callable ? callable.on(Path.from(receiverOrInput as PathLike)) : callable.path
    const reference: CompatibleCallableReference = Object.freeze({
      origin: ADMIN_ORIGIN,
      revision: snapshot.publication.schema.revision,
      callable: callable.key as Key.Callable,
      target,
      outputMode: callable.definition.output.mode,
    })
    return invokeCompatible(
      session,
      snapshot,
      reference,
      ('on' in callable ? inputOrOptions : receiverOrInput) as Input,
      ('on' in callable ? options : inputOrOptions) as SessionRequestOptions | undefined,
    )
  }) as AdminBindingOperations['invoke']

  return Object.freeze({
    ...domain,
    $: Object.freeze({
      ...domain.$,
      installation,
      publication: snapshot.publication,
      invoke,
    }),
  }) as AdminBinding
}

async function invokeCompatible(
  session: ClientSession,
  snapshot: SessionSnapshot,
  reference: CompatibleCallableReference,
  input: Input,
  options: SessionRequestOptions | undefined,
): Promise<unknown> {
  const current = session as unknown as CompatibleSession
  if (current.invoke !== undefined) return current.invoke(reference, input, options)

  const dispatchBound = (sessionModule as unknown as { dispatchBound?: LegacyDispatchBound })
    .dispatchBound
  if (dispatchBound === undefined) {
    throw new TypeError('Client Session cannot invoke an exact Admin publication.')
  }
  const result = await dispatchBound(
    session,
    call(reference.target, input),
    {
      schema: { revision: reference.revision },
      publication: {
        origin: snapshot.publication.origin,
        identity: snapshot.publication.identity,
        revision: snapshot.publication.schema.revision,
        etag: snapshot.publication.etag,
      },
    },
    options,
  )
  return requireOutput(reference.outputMode, result)
}

function requireOutput(
  expected: CompatibleCallableReference['outputMode'],
  result: Result,
): unknown {
  if (result.kind !== expected) {
    if (result.kind === 'stream') void result.stream.cancel(`Admin callable declared ${expected}.`)
    throw new TypeError(`Admin callable declared ${expected} output but returned ${result.kind}.`)
  }
  return result.kind === 'stream' ? result.stream : result.value
}
