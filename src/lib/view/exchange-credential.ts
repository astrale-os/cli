import { credential, grant } from '@astrale-os/sdk/auth'

import type { ConnectionOptions, ConnectionTarget } from '../../connection/target'

import { resolveCredential, resolvePersistedIdpSourceIdentity } from '../../connection/auth'
import { createExchangeCredentialResolver } from '../../connection/exchange'
import { exchangeCredentialTtlSeconds } from '../../connection/lifetime'
import { resolveTimeoutMs } from '../../connection/session'
import { registrationKeyForTarget } from '../../connection/target'
import { fetchWithCaFile } from '../ca-fetch'
import { readConfig } from '../config'
import { exchangeCallerProof } from '../exchange-grant'

/** Hand the View a Domain bearer carrying only the selected caller's proof. */
export async function exchangeViewCredential(
  options: ConnectionOptions,
  target: ConnectionTarget,
): Promise<{ token: string; expiresAt: number }> {
  if (target.domainIssuer === undefined || options.creds !== undefined) {
    throw new TypeError('View exchange requires a configured Domain and selected identity.')
  }
  const config = await readConfig()
  const timeoutMs = resolveTimeoutMs(options.timeout)
  const selection = { ...options, defaultIdentity: target.defaultIdentity }
  const resolver = createExchangeCredentialResolver(
    { ...target, domainIssuer: target.domainIssuer },
    {
      cacheIdentity: () => resolvePersistedIdpSourceIdentity(selection),
      resolve: (audience) =>
        resolveCredential(
          { ...selection, minimumRemainingSeconds: exchangeCredentialTtlSeconds(timeoutMs) },
          config,
          audience,
          registrationKeyForTarget(target),
        ),
    },
    target.caFile === undefined ? fetch : fetchWithCaFile(target.caFile),
    timeoutMs,
  )
  const token = await resolver.resolve(target.kernelIssuer, AbortSignal.timeout(timeoutMs))
  const outer = credential.inspect(token)
  const proof = exchangeCallerProof(grant.acceptUnresolved(outer.claims.grant).expr)
  if (proof === undefined) throw new TypeError('View exchange is missing the caller proof.')
  const expiresAt =
    Math.min(Number(outer.claims.exp), Number(credential.inspect(proof).claims.exp)) * 1000
  if (!Number.isSafeInteger(expiresAt)) throw new TypeError('Invalid View credential expiration.')
  return { token, expiresAt }
}
