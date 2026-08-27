import type { ProvisionRequest } from '@astrale-os/sdk/auth'
import type { Call } from '@astrale-os/sdk/client'
import type { LocalBinding } from '@astrale-os/sdk/graph'

import { issuer } from '@astrale-os/sdk/auth'
import { call } from '@astrale-os/sdk/client'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { Path } from '@astrale-os/sdk/graph/path'

export interface IdentityRegistrationResult {
  readonly iss: string
  readonly sub: string
  readonly nodeId?: string
}

export interface IdentityProvisionSubmission {
  readonly request: ProvisionRequest
  readonly binding: LocalBinding
  readonly expected: Pick<IdentityRegistrationResult, 'iss' | 'sub'>
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
  return acceptProvisionedIdentity(result, input.binding, input.expected)
}

/** Admit only the exact binding the CLI prepared; remote callables remain untrusted input. */
export function acceptProvisionedIdentity(
  value: unknown,
  binding: LocalBinding,
  expected: Pick<IdentityRegistrationResult, 'iss' | 'sub'>,
): IdentityRegistrationResult {
  const result = record(value, 'Provision result')
  const createdNodes = record(result.createdNodes, 'Provision result created Nodes')
  const nodeId = NodeId(text(createdNodes[binding], 'Provisioned Identity Node'))
  const identities = array(result.identities, 'Provision result identities')
  const matches = identities
    .map((identity) => record(identity, 'Provision result Identity'))
    .filter((identity) => identity.id === nodeId)
  if (matches.length !== 1) {
    throw new TypeError('Provision result must contain the one created Identity.')
  }
  const identity = matches[0]!
  const iss = issuer.accept(text(identity.iss, 'Provisioned Identity issuer'))
  const sub = text(identity.sub, 'Provisioned Identity subject')
  if (iss !== expected.iss || sub !== expected.sub) {
    throw new TypeError('Provision result Identity does not match the self-proven Authentication.')
  }
  return Object.freeze({
    iss,
    sub,
    nodeId,
  })
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`)
  return value
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
