import type { Input } from '@astrale-os/kernel-client'
import type {
  CallableReference,
  ClientSession,
  ReadyInstallation,
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

import { Domain } from '@astrale-os/sdk/domain'
import { Path } from '@astrale-os/sdk/graph/path'

const ADMIN_ORIGIN = 'admin.astrale.ai'

type DynamicCallable =
  | (Definition<'function'> & { readonly path: NonNullable<Definition<'function'>['path']> })
  | StaticMethod
  | InstanceMethod

export interface AdminBindingOperations {
  readonly installation: ReadyInstallation
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

/** Bind the Admin revision advertised by this exact Session snapshot. */
export async function bindAdmin(session: ClientSession): Promise<AdminBinding> {
  const snapshot = await session.snapshot()
  if (
    snapshot.publication.origin !== ADMIN_ORIGIN ||
    snapshot.bundle.root.origin !== ADMIN_ORIGIN
  ) {
    throw new TypeError('Configured Admin target does not serve the Admin Domain.')
  }
  const installation = await session.installation(ADMIN_ORIGIN)
  const domain = Domain.fromSchema(snapshot.bundle.root)
  const invoke = ((
    callable: DynamicCallable,
    receiverOrInput: PathLike | Input,
    inputOrOptions?: Input | SessionRequestOptions,
    options?: SessionRequestOptions,
  ) => {
    const target =
      'on' in callable ? callable.on(Path.from(receiverOrInput as PathLike)) : callable.path
    const reference: CallableReference = Object.freeze({
      origin: ADMIN_ORIGIN,
      revision: snapshot.publication.schema.revision,
      callable: callable.key as Key.Callable,
      target,
      outputMode: callable.definition.output.mode,
    })
    return session.invoke(
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
