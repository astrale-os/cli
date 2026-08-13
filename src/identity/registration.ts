import type { Call } from '@astrale-os/kernel-client'
import type { ProvisionRequest } from '@astrale-os/kernel-core/auth'
import type { LocalBinding } from '@astrale-os/kernel-core/graph/graph'

import { call } from '@astrale-os/kernel-client'
import { issuer } from '@astrale-os/kernel-core/auth'
import { NodeId } from '@astrale-os/kernel-core/graph/node'
import { Path } from '@astrale-os/kernel-core/path'

export interface IdentityRegistrationResult {
  readonly iss: string
  readonly sub: string
  readonly nodeId?: string
}

export interface IdentityProvisionSubmission {
  readonly request: ProvisionRequest
  readonly binding: LocalBinding
  readonly via?: string
  readonly direct: {
    provision(request: ProvisionRequest): Promise<unknown>
  }
  readonly callable: {
    call(call: Call): Promise<unknown>
  }
}

/** Submit one prepared request either directly or through its explicit Domain authority owner. */
export async function submitIdentityProvision(
  input: IdentityProvisionSubmission,
): Promise<IdentityRegistrationResult> {
  const result =
    input.via === undefined
      ? await input.direct.provision(input.request)
      : await input.callable.call(
          // Client admits the portable value before transport. ProvisionRequest is the
          // stricter semantic type but does not declare the portable Object index signature.
          call(Path.parse(input.via), input.request as unknown as Call['input']),
        )
  return acceptProvisionedIdentity(result, input.binding)
}

/** Admit only the exact binding the CLI prepared; remote callables remain untrusted input. */
export function acceptProvisionedIdentity(
  value: unknown,
  binding: LocalBinding,
): IdentityRegistrationResult {
  const result = record(value, 'Provision result')
  const identities = record(result.identities, 'Provision result identities')
  const identity = record(identities[binding], 'Provision result identity binding')
  const createdNodes = record(result.createdNodes, 'Provision result created Nodes')
  const node = createdNodes[binding]
  return Object.freeze({
    iss: issuer.accept(text(identity.issuer, 'Provisioned Identity issuer')),
    sub: text(identity.subject, 'Provisioned Identity subject'),
    ...(node === undefined ? {} : { nodeId: NodeId(text(node, 'Provisioned Identity Node')) }),
  })
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be non-empty text.`)
  }
  return value
}
