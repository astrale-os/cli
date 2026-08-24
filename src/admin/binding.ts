import type { Input } from '@astrale-os/sdk/client'
import type { ClientSession } from '@astrale-os/sdk/client/session'
import type {
  ResolvedClass,
  ResolvedCoreDefinition,
  ResolvedMethod,
  ResolvedProperty,
} from '@astrale-os/sdk/schema'
import type { DomainBinding } from '@astrale-os/shell'

import { reference } from '@astrale-os/sdk/client/session'
import { Path } from '@astrale-os/sdk/graph/path'
import { bindDomain } from '@astrale-os/shell'

const ADMIN_ORIGIN = 'admin.astrale.ai'

export type AdminBinding = DomainBinding

/** Bind the exact Admin revision installed on this source Kernel. */
export async function bindAdmin(session: ClientSession): Promise<AdminBinding> {
  const installed = await session.installation(ADMIN_ORIGIN)
  return requireAdminBinding(await bindDomain(session, installed.bundle.root))
}

/** Admit an injected dynamic binding as the Admin Domain. */
export function requireAdminBinding(binding: AdminBinding): AdminBinding {
  if (binding.domain.origin !== ADMIN_ORIGIN) {
    throw new TypeError('Configured Admin target does not serve the Admin Domain.')
  }
  return binding
}

/** Resolve one required Admin Class without rebuilding its schema contract. */
export function requireAdminClass(
  binding: AdminBinding,
  name: string,
  kind: 'node',
): ResolvedClass<'node'>
export function requireAdminClass(
  binding: AdminBinding,
  name: string,
  kind: 'edge',
): ResolvedClass<'edge'>
export function requireAdminClass(
  binding: AdminBinding,
  name: string,
  kind: 'node' | 'edge',
): ResolvedClass<'node'> | ResolvedClass<'edge'> {
  const selected = binding.domain.classes[name]
  if (selected?.kind !== kind) throw new TypeError(`Admin ${name} is not a ${kind} Class.`)
  return selected
}

/** Resolve one required Admin Core Node as its canonical projection Path. */
export function requireAdminCore(binding: AdminBinding, name: string): Path {
  const selected = binding.domain.core.nodes[name] as ResolvedCoreDefinition | undefined
  if (selected === undefined) throw new TypeError(`Admin has no Core Node ${name}.`)
  return Path.project(selected.ref)
}

/** Resolve one effective Property by unambiguous member name. */
export function requireAdminProperty(
  owner: ResolvedClass,
  name: string,
): ResolvedProperty<unknown> {
  const selected = [...owner.properties].find((property) => property.name === name)
  if (selected === undefined) {
    throw new TypeError(`Admin ${owner.ref.name}.${name} Property is absent.`)
  }
  return selected
}

/** Invoke one resolved executable instance Method through Kernel Client. */
export async function invokeAdminMethod(
  session: ClientSession,
  binding: AdminBinding,
  owner: ResolvedClass<'node'>,
  name: string,
  receiver: Path,
  input: Input,
): Promise<unknown> {
  const method = [...owner.methods].find((candidate) => candidate.name === name)
  if (method === undefined || !isExecutableInstanceMethod(method)) {
    throw new TypeError(`Admin ${owner.ref.name}.${name} is not an executable instance Method.`)
  }
  return session.invoke(reference(binding.domain, method)(receiver), input)
}

type ExecutableInstanceMethod = ResolvedMethod<
  unknown,
  unknown,
  false,
  Exclude<ResolvedMethod['inheritance'], 'abstract'>
>

function isExecutableInstanceMethod(method: ResolvedMethod): method is ExecutableInstanceMethod {
  return method.static === false && method.inheritance !== 'abstract'
}
