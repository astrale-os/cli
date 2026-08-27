import type { ProvisionRequest, ProvisionResult } from '@astrale-os/sdk/auth'
import type { LocalBinding } from '@astrale-os/sdk/mutation'

interface RegistrationAuthority {
  prepareSelfProven(input: {
    readonly identity: string
    readonly classPath: string
    readonly properties: Readonly<Record<string, unknown>>
    readonly kernelIssuer: string
  }): Promise<{
    readonly binding: LocalBinding
    readonly request: ProvisionRequest
    readonly expected: { readonly iss: string; readonly sub: string }
  }>
  call(input: {
    readonly target: string
    readonly request: ProvisionRequest
  }): Promise<ProvisionResult>
  persist(input: {
    readonly identity: string
    readonly targetKey: string
    readonly issuer: string
    readonly subject: string
  }): Promise<void>
}

/** Application Identity Classes are provisioned only through their explicit authority owner. */
export async function registerThroughDomain(
  authority: RegistrationAuthority,
  input: {
    readonly identity: string
    readonly classPath: string
    readonly properties: Readonly<Record<string, unknown>>
    readonly kernelIssuer: string
    readonly targetKey: string
    readonly callable: string
  },
): Promise<{ readonly issuer: string; readonly subject: string; readonly nodeId: string }> {
  const prepared = await authority.prepareSelfProven(input)
  const result = await authority.call({ target: input.callable, request: prepared.request })
  const nodeId = result.createdNodes[prepared.binding]
  const identities = result.identities.filter((candidate) => candidate.id === nodeId)
  const identity = identities.length === 1 ? identities[0] : undefined
  if (
    nodeId === undefined ||
    identity === undefined ||
    identity.iss !== prepared.expected.iss ||
    identity.sub !== prepared.expected.sub
  ) {
    throw new Error('Provision result omitted the prepared created Identity.')
  }
  await authority.persist({
    identity: input.identity,
    targetKey: input.targetKey,
    issuer: identity.iss,
    subject: identity.sub,
  })
  return {
    issuer: identity.iss,
    subject: identity.sub,
    nodeId,
  }
}
