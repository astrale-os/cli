import { MEDIA_TYPE } from '@astrale-os/sdk/release'
import { defineSchema } from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'

import { deploymentReleaseFor, releaseFor } from '../../__tests__/fixtures/publication'
import { DeploymentReadError, readServedDeployment, samePin } from '../domain-release'

const URL_V4 = 'https://crm-production-0123456789abcdef.deployments.example.test'
const URL_V3 = 'https://crm.example.test'
const schema = defineSchema('crm.example.test', {})
const release = deploymentReleaseFor(schema, URL_V4).document
const publication = releaseFor(schema, URL_V3).publication

interface Seen {
  readonly url: string
  readonly accept: string | null
  readonly redirect?: RequestRedirect
}

function serve(routes: Record<string, () => Response>) {
  const seen: Seen[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    seen.push({
      url,
      accept: new Headers(init?.headers).get('accept'),
      redirect: init?.redirect,
    })
    const route = routes[new URL(url).pathname]
    return route === undefined ? new Response('missing', { status: 404 }) : route()
  }
  return { seen, fetch }
}

const releaseResponse = () =>
  new Response(JSON.stringify(release), { headers: { 'content-type': MEDIA_TYPE } })

describe('deployment pre-read', () => {
  test('reads release.json under the v4 media type as the pinned release', async () => {
    const { seen, fetch } = serve({ '/.well-known/astrale/release.json': releaseResponse })

    await expect(readServedDeployment(`${URL_V4}/`, undefined, fetch)).resolves.toEqual({
      origin: 'crm.example.test',
      issuer: URL_V4,
      revision: release.schema.revision,
      pin: { kind: 'release', release: release.digest, build: release.build.digest },
    })
    expect(seen).toEqual([
      { url: `${URL_V4}/.well-known/astrale/release.json`, accept: MEDIA_TYPE, redirect: 'error' },
    ])
  })

  test('reads both documents at the origin, as the Kernel resolves them', async () => {
    const { seen, fetch } = serve({ '/.well-known/astrale/release.json': releaseResponse })
    await readServedDeployment(`${URL_V4}/some/path`, undefined, fetch)
    expect(seen.map(({ url }) => url)).toEqual([`${URL_V4}/.well-known/astrale/release.json`])
  })

  test('reads the legacy domain.json only when release.json is absent', async () => {
    const { seen, fetch } = serve({
      '/.well-known/astrale/domain.json': () => Response.json(publication),
    })

    await expect(readServedDeployment(URL_V3, undefined, fetch)).resolves.toEqual({
      origin: 'crm.example.test',
      issuer: URL_V3,
      revision: publication.schema.revision,
      pin: { kind: 'legacy', document: publication.version, etag: publication.etag },
    })
    expect(seen.map(({ url }) => url)).toEqual([
      `${URL_V3}/.well-known/astrale/release.json`,
      `${URL_V3}/.well-known/astrale/domain.json`,
    ])
  })

  test('reads the legacy domain.json when release.json answers 2xx under another media type', async () => {
    const { fetch } = serve({
      '/.well-known/astrale/release.json': () => new Response('<html>', { status: 200 }),
      '/.well-known/astrale/domain.json': () => Response.json(publication),
    })
    await expect(readServedDeployment(URL_V3, undefined, fetch)).resolves.toMatchObject({
      pin: { kind: 'legacy' },
    })
  })

  test('marks a 503 (not serving yet) retryable, with its Retry-After', async () => {
    const { seen, fetch } = serve({
      '/.well-known/astrale/release.json': () =>
        new Response('later', { status: 503, headers: { 'retry-after': '30' } }),
    })
    const error = await readServedDeployment(URL_V4, undefined, fetch).catch((cause) => cause)
    expect(error).toBeInstanceOf(DeploymentReadError)
    expect(error).toMatchObject({ retryable: true, retryAfterMs: 30_000 })
    expect(seen).toHaveLength(1)
  })

  test('never reads an unavailable release as a legacy pin', async () => {
    const { seen, fetch } = serve({
      '/.well-known/astrale/release.json': () => new Response('boom', { status: 500 }),
      '/.well-known/astrale/domain.json': () => Response.json(publication),
    })
    const error = await readServedDeployment(URL_V3, undefined, fetch).catch((cause) => cause)
    expect(error).toBeInstanceOf(DeploymentReadError)
    expect(error).toMatchObject({ retryable: false })
    expect(seen.map(({ url }) => url)).toEqual([`${URL_V3}/.well-known/astrale/release.json`])
  })

  test('refuses an invalid release without falling back', async () => {
    const { fetch } = serve({
      '/.well-known/astrale/release.json': () =>
        new Response(JSON.stringify({ ...release, digest: `sha256:${'0'.repeat(64)}` }), {
          headers: { 'content-type': MEDIA_TYPE },
        }),
      '/.well-known/astrale/domain.json': () => Response.json(publication),
    })
    await expect(readServedDeployment(URL_V4, undefined, fetch)).rejects.toThrow(
      'returned an invalid Domain release',
    )
  })

  test('marks a 503 legacy domain.json retryable', async () => {
    const { fetch } = serve({
      '/.well-known/astrale/domain.json': () => new Response('later', { status: 503 }),
    })
    await expect(readServedDeployment(URL_V3, undefined, fetch)).rejects.toMatchObject({
      retryable: true,
    })
  })

  test('compares pins by their one meaning per variant', () => {
    const pin = { kind: 'release', release: release.digest, build: release.build.digest } as const
    expect(samePin(pin, { ...pin })).toBe(true)
    expect(samePin(pin, { ...pin, build: `sha256:${'c'.repeat(64)}` })).toBe(false)
    const legacy = { kind: 'legacy', document: 3, etag: publication.etag } as const
    expect(samePin(legacy, { ...legacy })).toBe(true)
    expect(samePin(legacy, pin)).toBe(false)
    expect(samePin(pin, legacy)).toBe(false)
  })
})
