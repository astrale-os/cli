import { createAuth } from '@astrale-os/sdk/auth'
import { call, Client, type Fetch } from '@astrale-os/sdk/client'
import { z } from 'zod'

import type { InstanceInfo } from '../admin/instance'
import type { KernelCommandOpts } from '../connection'
import type { AdminTargetCommandOpts } from './admin-target'

import { AstraleError } from '../errors'
import { readIdentities } from '../identity'
import { resolveAdminTarget } from './admin-target'
import { readConfig } from './config'
import { accessTokenForAudience } from './idp'
import { ensureFreshSession } from './idp-session'

type Options = KernelCommandOpts & AdminTargetCommandOpts
const completion = z.strictObject({
  status: z.literal('completed'),
  user: z.string().min(1).max(256),
})
export type InstanceActivation = z.infer<typeof completion>

/** Finish Admin's retained owner activation with the selected human's child-audience proof. */
export async function activateInstance(
  instance: InstanceInfo,
  options: Options,
): Promise<InstanceActivation> {
  if (options.creds)
    throw new AstraleError(
      'OWNER_ACTIVATION_IDENTITY_REQUIRED',
      'Select the WorkOS identity with --as; an Admin bearer cannot activate a child audience.',
    )
  if (instance.state !== 'ready' || !instance.organizationId)
    throw new AstraleError(
      'OWNER_ACTIVATION_NOT_READY',
      'The Instance is not ready for owner activation.',
    )
  const identities = await readIdentities()
  const name = options.as ?? identities.default
  if (identities.identities[name]?.source !== 'idp')
    throw new AstraleError(
      'OWNER_ACTIVATION_IDENTITY_REQUIRED',
      'Owner activation requires a WorkOS identity.',
    )
  const admin = await resolveAdminTarget(options, await readConfig())
  const target = new URL(instance.issuer ?? instance.url)
  if (target.protocol !== 'https:' || target.href !== `${target.origin}/api`)
    throw new AstraleError(
      'OWNER_ACTIVATION_TARGET_INVALID',
      'The Instance has no canonical HTTPS Kernel audience.',
    )
  const endpoint = new URL('/v1/owner-activation', admin.domainIssuer)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password)
    throw new AstraleError(
      'OWNER_ACTIVATION_TARGET_INVALID',
      'Admin activation requires a configured HTTPS Domain issuer.',
    )
  return activateOwner({
    endpoint: endpoint.href,
    instanceOrigin: target.origin,
    credential: async () => {
      const session = await ensureFreshSession(name, {
        audience: target.href,
        organizationId: instance.organizationId,
        minimumRemainingSeconds: 150,
      })
      const token = accessTokenForAudience(session, target.href)
      if (!token)
        throw new AstraleError(
          'OWNER_ACTIVATION_IDENTITY_REQUIRED',
          'No primary credential for the Instance audience is available.',
        )
      return token
    },
    whoami: async (token, signal) => {
      const client = new Client({ url: `${target.href}/invoke`, timeoutMs: 15000 })
      try {
        const session = client.as(token)
        const auth = createAuth(
          async (path, input, request) =>
            (await session.call(call(path, input), { ...request, delegate: { ttlSeconds: 30 } }))
              .value,
        )
        return (await auth.whoami({ signal })).id
      } finally {
        client.close()
      }
    },
  })
}

/** Finalize one retained owner, then verify it. A new create invocation owns recovery. */
export async function activateOwner(
  input: {
    readonly endpoint: string
    readonly instanceOrigin: string
    readonly credential: () => Promise<string>
    readonly whoami: (credential: string, signal: AbortSignal) => Promise<string>
  },
  dependencies: { fetch: Fetch } = { fetch: globalThis.fetch },
): Promise<InstanceActivation> {
  const token = await input.credential()
  // Token rotation has its own locked lifecycle; start the request budget afterward.
  const signal = AbortSignal.timeout(120000)
  let response: Response
  try {
    response = await dependencies.fetch(input.endpoint, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ instanceOrigin: input.instanceOrigin }),
    })
  } catch {
    throw new AstraleError(
      'OWNER_ACTIVATION_UNAVAILABLE',
      'The Instance exists, but owner access could not be confirmed.',
    )
  }
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new AstraleError(
      response.status === 503
        ? 'OWNER_ACTIVATION_UNAVAILABLE'
        : response.status === 401
          ? 'OWNER_ACTIVATION_REJECTED'
          : 'OWNER_ACTIVATION_PROTOCOL_INVALID',
      'Admin could not confirm this owner activation.',
    )
  }
  const result = completion.safeParse(await response.json().catch(() => undefined))
  if (!result.success)
    throw new AstraleError(
      'OWNER_ACTIVATION_PROTOCOL_INVALID',
      'Admin returned an invalid activation receipt.',
    )
  const observed = await input.whoami(token, signal)
  if (observed !== result.data.user)
    throw new AstraleError(
      'OWNER_ACTIVATION_IDENTITY_MISMATCH',
      'The activated owner does not match the authenticated Instance identity.',
    )
  return result.data
}
