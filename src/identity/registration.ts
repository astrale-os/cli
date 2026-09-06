import type { Authentication, RegisterRequest } from '@astrale-os/sdk/auth'
import type { Call } from '@astrale-os/sdk/client'
import type { NodeId } from '@astrale-os/sdk/graph/node'

import { issuer } from '@astrale-os/sdk/auth'
import { call } from '@astrale-os/sdk/client'
import { Path } from '@astrale-os/sdk/graph/path'

export interface IdentityRegistrationResult {
  readonly iss: string
  readonly sub: string
  readonly nodeId?: string
}

export interface RegisteredIdentity extends IdentityRegistrationResult {
  readonly nodeId: string
}

export interface IdentityRegistrationSubmission {
  readonly request: RegisterRequest
  readonly nodeId: NodeId
  readonly expectedAuthentication: Authentication
  readonly via?: string
  readonly direct: {
    register(request: RegisterRequest): Promise<unknown>
  }
  readonly callable: {
    call(call: Call): Promise<unknown>
  }
}

/** Submit one prepared request either directly or through its explicit Domain authority owner. */
export async function submitIdentityRegistration(
  input: IdentityRegistrationSubmission,
): Promise<RegisteredIdentity> {
  const result =
    input.via === undefined
      ? await input.direct.register(input.request)
      : await input.callable.call(
          // Client admits the portable value before transport. RegisterRequest is the
          // stricter semantic type but does not declare the portable Object index signature.
          call(Path.parse(input.via), input.request as unknown as Call['input']),
        )
  return acceptRegisteredIdentity(result, input.nodeId, input.expectedAuthentication)
}

/** Admit only the selected existing Node; remote callables remain untrusted input. */
export function acceptRegisteredIdentity(
  value: unknown,
  nodeId: NodeId,
  expectedAuthentication: Authentication,
): RegisteredIdentity {
  const result = record(value, 'Register result')
  const identities = array(result.identities, 'Register result identities')
  const matches = identities.filter((candidate) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
      return false
    return (candidate as Record<string, unknown>).id === nodeId
  })
  if (matches.length !== 1) {
    throw new TypeError('Register result must contain exactly one Identity for the selected Node.')
  }
  const identity = record(matches[0], 'Register result identity')
  const iss = issuer.accept(text(identity.iss, 'Registered Identity issuer'))
  const sub = text(identity.sub, 'Registered Identity subject')
  if (iss !== expectedAuthentication.iss || sub !== expectedAuthentication.sub) {
    throw new TypeError('Register result substituted the prepared Authentication.')
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
