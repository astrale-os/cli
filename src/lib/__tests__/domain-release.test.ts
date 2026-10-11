import { MEDIA_TYPE } from '@astrale-os/sdk/release'
import { defineSchema } from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'

import { deploymentReleaseFor } from '../../__tests__/fixtures/publication'
import {
  DeploymentReadError,
  MAXIMUM_BUNDLE_BYTES,
  readReleaseBundle,
  readServedDeployment,
  samePin,
} from '../domain-release'

const URL_V4 = 'https://crm-production-0123456789abcdef.deployments.example.test'
const schema = defineSchema('crm.example.test', { name: 'Test Domain' })
const deployment = deploymentReleaseFor(schema, URL_V4)
const release = deployment.document
const bundleBytes = deployment.build.schema.bundle.bytes().slice()

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
  test('reads release.json at the origin under the v4 media type as the pinned release', async () => {
    const { seen, fetch } = serve({ '/.well-known/astrale/release.json': releaseResponse })

    const served = await readServedDeployment(`${URL_V4}/some/path`, undefined, fetch)

    expect(served).toEqual({
      origin: 'crm.example.test',
      issuer: URL_V4,
      revision: release.schema.revision,
      pin: { kind: 'release', release: release.digest, build: release.build.digest },
      release,
    })
    expect(seen).toEqual([
      { url: `${URL_V4}/.well-known/astrale/release.json`, accept: MEDIA_TYPE, redirect: 'error' },
    ])
    expect(samePin(served.pin, { ...served.pin })).toBe(true)
    expect(samePin(served.pin, { ...served.pin, build: `sha256:${'c'.repeat(64)}` })).toBe(false)
  })

  test.each([
    ['missing', () => new Response('missing', { status: 404 })],
    ['served under another media type', () => new Response('<html>', { status: 200 })],
    ['unavailable', () => new Response('boom', { status: 500 })],
    [
      'invalid',
      () =>
        new Response(JSON.stringify({ ...release, digest: `sha256:${'0'.repeat(64)}` }), {
          headers: { 'content-type': MEDIA_TYPE },
        }),
    ],
  ] as const)('refuses a release that is %s, once, without retry', async (_label, response) => {
    const { seen, fetch } = serve({ '/.well-known/astrale/release.json': response })
    await expect(readServedDeployment(URL_V4, undefined, fetch)).rejects.toMatchObject({
      name: 'DeploymentReadError',
      retryable: false,
    })
    expect(seen).toHaveLength(1)
  })

  test('marks a 503 (not serving yet) retryable, with its Retry-After', async () => {
    const { fetch } = serve({
      '/.well-known/astrale/release.json': () =>
        new Response('later', { status: 503, headers: { 'retry-after': '30' } }),
    })
    await expect(readServedDeployment(URL_V4, undefined, fetch)).rejects.toMatchObject({
      name: 'DeploymentReadError',
      retryable: true,
      retryAfterMs: 30_000,
    })
  })
})

describe('release bundle read (install pre-check)', () => {
  const bundlePath = new URL(release.schema.bundle.href).pathname
  const mediaType = release.schema.bundle.ref.mediaType
  const bundleResponse = (bytes: Uint8Array<ArrayBuffer> = bundleBytes, type: string = mediaType) =>
    new Response(bytes, { headers: { 'content-type': type } })

  test('reads the bundle the release names, from its own origin, without redirects', async () => {
    const { seen, fetch } = serve({ [bundlePath]: () => bundleResponse() })

    const read = await readReleaseBundle(release, URL_V4, undefined, fetch)

    expect(read.root.origin).toBe('crm.example.test')
    // The Kernel asks for the descriptor's media type, so a negotiating deployment answers both alike.
    expect(seen).toEqual([
      { url: release.schema.bundle.href, accept: mediaType, redirect: 'error' },
    ])
  })

  test('compares the media type as the Kernel does: case and spaces aside', async () => {
    const lenient = serve({
      [bundlePath]: () => bundleResponse(bundleBytes, mediaType.toUpperCase().replace(';', ' ; ')),
    })
    await expect(
      readReleaseBundle(release, URL_V4, undefined, lenient.fetch),
    ).resolves.toMatchObject({
      root: { origin: 'crm.example.test' },
    })
    const other = serve({ [bundlePath]: () => bundleResponse(bundleBytes, 'application/json') })
    await expect(readReleaseBundle(release, URL_V4, undefined, other.fetch)).rejects.toThrow(
      `is not served as ${mediaType}`,
    )
  })

  test.each([
    [
      'more than the Kernel admits, whatever the release declares',
      MAXIMUM_BUNDLE_BYTES + 10,
      MAXIMUM_BUNDLE_BYTES + 1,
    ],
    ['more than the descriptor declares', undefined, release.schema.bundle.ref.size + 1],
  ] as const)('reads no more bytes than %s', async (_name, declared, served) => {
    const named =
      declared === undefined
        ? release
        : ({
            ...release,
            schema: {
              ...release.schema,
              bundle: {
                ...release.schema.bundle,
                ref: { ...release.schema.bundle.ref, size: declared },
              },
            },
          } as typeof release)
    const { fetch } = serve({ [bundlePath]: () => bundleResponse(new Uint8Array(served)) })

    await expect(readReleaseBundle(named, URL_V4, undefined, fetch)).rejects.toMatchObject({
      name: 'DeploymentReadError',
      message: expect.stringContaining('exceeded'),
    })
  })

  test('refuses bytes that are not the bundle the release names', async () => {
    // Same size, one byte flipped: the digest the descriptor names no longer matches.
    const tampered = bundleBytes.slice()
    tampered[tampered.length - 2] = tampered[tampered.length - 2]! ^ 1
    const { fetch } = serve({ [bundlePath]: () => bundleResponse(tampered) })

    await expect(readReleaseBundle(release, URL_V4, undefined, fetch)).rejects.toBeInstanceOf(
      DeploymentReadError,
    )
  })

  test('refuses a bundle named on another origin than the deployment', async () => {
    const { seen, fetch } = serve({})

    await expect(
      readReleaseBundle(release, 'https://elsewhere.example.test', undefined, fetch),
    ).rejects.toThrow('names its bundle on another origin')
    expect(seen).toEqual([])
  })
})
