import { describe, expect, test } from 'bun:test'

import { checkIssuerReachability } from '../meta'

const ISSUER = 'https://host.example/kernel/child'
const INVOCATION = `${ISSUER}/invoke`

describe('issuer reachability', () => {
  /** @evidence TEST-CLI-CONNECTION-PROBES-PINNED-ISSUER */
  test('probes OIDC discovery at the separately pinned issuer, not the invocation endpoint', async () => {
    const requests: string[] = []
    const fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      requests.push(url)
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return Response.json({
          issuer: ISSUER,
          jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        })
      }
      if (url === `${ISSUER}/.well-known/jwks.json`) {
        return Response.json({ keys: [{ kid: 'bootstrap' }] })
      }
      return new Response(null, { status: 404 })
    }

    await expect(checkIssuerReachability(INVOCATION, ISSUER, fetch)).resolves.toEqual({
      issuer: ISSUER,
      keys: [{ kid: 'bootstrap' }],
    })
    expect(requests).toEqual([
      `${ISSUER}/.well-known/openid-configuration`,
      `${ISSUER}/.well-known/jwks.json`,
    ])
  })

  /** @evidence TEST-CLI-CONNECTION-REJECTS-DISCOVERY-ISSUER-MISMATCH */
  test('rejects discovery that contradicts the separately pinned issuer', async () => {
    const conflictingIssuer = 'https://attacker.example/kernel/child'
    const fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer: conflictingIssuer,
          jwks_uri: `${conflictingIssuer}/.well-known/jwks.json`,
        })
      }
      return Response.json({ keys: [{ kid: 'attacker' }] })
    }

    await expect(checkIssuerReachability(INVOCATION, ISSUER, fetch)).rejects.toMatchObject({
      code: 'ISSUER_UNREACHABLE',
    })
  })
})
