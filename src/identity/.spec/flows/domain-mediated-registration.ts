import type { Authentication, RegisterRequest, RegisterResult } from '@astrale-os/sdk/auth'
import type { LocalAlias } from '@astrale-os/sdk/mutation'

interface RegistrationAuthority {
  prepareSelfProven(input: {
    readonly identity: string
    readonly classPath: string
    readonly properties: Readonly<Record<string, unknown>>
    readonly kernelIssuer: string
  }): Promise<{
    readonly binding: LocalAlias
    readonly request: RegisterRequest
    readonly authentication: Authentication
  }>
  call(input: {
    readonly target: string
    readonly request: RegisterRequest
  }): Promise<RegisterResult>
  persist(input: {
    readonly identity: string
    readonly targetKey: string
    readonly issuer: string
    readonly subject: string
  }): Promise<void>
}

/** Application Identity Classes are registered only through their explicit authority owner. */
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
  const matches = result.identities.filter((candidate) => candidate.id === nodeId)
  if (nodeId === undefined || matches.length !== 1) {
    throw new Error('Register result omitted or substituted the prepared binding.')
  }
  const identity = matches[0]
  if (identity.iss === undefined || identity.sub === undefined) {
    throw new Error('Register result omitted the prepared Authentication.')
  }
  if (
    identity.iss !== prepared.authentication.iss ||
    identity.sub !== prepared.authentication.sub
  ) {
    throw new Error('Register result substituted the prepared Authentication.')
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
