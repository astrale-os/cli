import { describe, expect, test } from 'bun:test'

import { IssuerUnreachableError } from '../../errors'
import { InstanceStoreSchema, type ResolvedInstance } from '../../lib/instance'
import { probeBookmark } from '../instance/use'

const resolved: ResolvedInstance = {
  name: 'stable',
  kind: 'bookmark',
  url: 'https://local.example/kernel',
  issuer: 'https://issuer.example',
  caFile: '/certs/stable.pem',
}

describe('instance use bookmark probe', () => {
  test('uses the CA stored on the selected bookmark', async () => {
    const scopedFetch = globalThis.fetch

    await expect(
      probeBookmark(resolved, {
        readInstances: async () =>
          InstanceStoreSchema.parse({
            active: 'stable',
            instances: {
              stable: { url: resolved.url, caFile: resolved.caFile },
            },
          }),
        fetchWithCaFile: (path) => {
          expect(path).toBe('/certs/stable.pem')
          return scopedFetch
        },
        checkIssuerReachability: async (url, issuer, fetchImpl) => {
          expect(url).toBe(resolved.url)
          expect(issuer).toBe(resolved.issuer)
          expect(fetchImpl).toBe(scopedFetch)
          return { issuer: resolved.issuer!, keys: [{ kid: 'key-1' }] }
        },
      }),
    ).resolves.toBeUndefined()
  })

  test('names conflicting bookmark CAs in a failed TLS probe', async () => {
    const failure = probeBookmark(resolved, {
      readInstances: async () =>
        InstanceStoreSchema.parse({
          active: 'stable',
          instances: {
            stable: { url: resolved.url, caFile: resolved.caFile },
            stale: { url: resolved.url, caFile: '/certs/old.pem' },
          },
        }),
      fetchWithCaFile: () => fetch,
      checkIssuerReachability: async () => {
        throw new IssuerUnreachableError(resolved.url, 'certificate verify failed')
      },
    })

    await expect(failure).rejects.toMatchObject({
      code: 'ISSUER_UNREACHABLE',
      message: `Issuer/JWKS probe failed for bookmark "stable" at ${resolved.url}.`,
    })
    await expect(failure).rejects.toHaveProperty(
      'hint',
      expect.stringContaining('"stale" (CA /certs/old.pem)'),
    )
  })
})
