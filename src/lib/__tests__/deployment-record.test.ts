import { describe, expect, test } from 'bun:test'

import { deploymentFixture, recordServer } from '../../__tests__/fixtures/deployment-record'
import {
  DEPLOYMENT_RECORD_MEDIA_TYPE,
  deploymentLabelOf,
  readDeploymentRecord,
} from '../deployment-record'

const RELEASE = `sha256:${'1'.repeat(64)}` as const
const BUILD = `sha256:${'2'.repeat(64)}` as const
const OTHER = `sha256:${'3'.repeat(64)}` as const

const staging = deploymentFixture({
  origin: 'agencies.example.com',
  environment: 'staging',
  release: RELEASE,
  build: BUILD,
  commit: { sha: 'a1b2c3d'.padEnd(40, '0'), dirty: false, base: { version: '1.4.2', distance: 7 } },
})

const installation = {
  origin: 'agencies.example.com',
  url: staging.url,
  pin: { kind: 'release' as const, release: RELEASE, build: BUILD },
}

function answering(response: () => Response) {
  const requests: string[] = []
  const fetchImpl = async (input: RequestInfo | URL) => {
    requests.push(String(input))
    return response()
  }
  return { fetchImpl, requests }
}

describe('deployment record reader (CT38)', () => {
  test('reads the record the dispatcher serves, once, anonymously, without following redirects', async () => {
    const server = recordServer([staging])
    let init: RequestInit | undefined
    const record = await readDeploymentRecord(installation, async (input, options) => {
      init = options
      return server.fetchImpl(input, options)
    })
    expect(record).toEqual(staging.record)
    expect(server.requests.map((request) => request.url)).toEqual([
      `${staging.url}/.well-known/astrale/deployment.json`,
    ])
    expect(server.requests[0]!.headers.get('accept')).toBe(DEPLOYMENT_RECORD_MEDIA_TYPE)
    expect(server.requests[0]!.headers.get('authorization')).toBeNull()
    expect(init?.redirect).toBe('error')
  })

  test('a record of another release, build or origin is no record', async () => {
    for (const pin of [
      { kind: 'release' as const, release: OTHER, build: BUILD },
      { kind: 'release' as const, release: RELEASE, build: OTHER },
    ]) {
      expect(
        await readDeploymentRecord({ ...installation, pin }, recordServer([staging]).fetchImpl),
      ).toBeUndefined()
    }
    expect(
      await readDeploymentRecord(
        { ...installation, origin: 'employees.example.com' },
        recordServer([staging]).fetchImpl,
      ),
    ).toBeUndefined()
  })

  test("a record served under another deployment's label is no record", async () => {
    const other = deploymentFixture({
      origin: 'agencies.example.com',
      environment: 'staging',
      release: RELEASE,
      build: BUILD,
      variant: 'other',
    })
    // The host of `staging` answers with the record of `other`: same release and build, other label.
    const { fetchImpl } = recordServer([{ url: staging.url, record: other.record }])
    expect(await readDeploymentRecord(installation, fetchImpl)).toBeUndefined()
  })

  test('another status, media type, oversize, invalid or refused body is no record', async () => {
    const body = JSON.stringify(staging.record)
    const cases: Array<() => Response> = [
      () => new Response('not active', { status: 503, headers: { 'retry-after': '30' } }),
      () => new Response('gone', { status: 410 }),
      () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
      () =>
        new Response('{', {
          status: 200,
          headers: { 'content-type': DEPLOYMENT_RECORD_MEDIA_TYPE },
        }),
      () =>
        new Response(JSON.stringify({ ...staging.record, extra: true }), {
          status: 200,
          headers: { 'content-type': DEPLOYMENT_RECORD_MEDIA_TYPE },
        }),
      () =>
        new Response(`${body}${' '.repeat(17 * 1_024)}`, {
          status: 200,
          headers: { 'content-type': DEPLOYMENT_RECORD_MEDIA_TYPE },
        }),
    ]
    for (const response of cases) {
      expect(
        await readDeploymentRecord(installation, answering(response).fetchImpl),
      ).toBeUndefined()
    }
    const failing = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await readDeploymentRecord(installation, failing)).toBeUndefined()
  })

  test('a host that is not a deployment label is never asked', async () => {
    const legacy = answering(() => new Response('{}', { status: 200 }))
    for (const url of [
      'https://services-domain-beta.astrale.workers.dev',
      'https://shell.astrale.ai',
      'http://127.0.0.1:18851',
    ]) {
      expect(await readDeploymentRecord({ ...installation, url }, legacy.fetchImpl)).toBeUndefined()
    }
    expect(legacy.requests).toEqual([])
    expect(deploymentLabelOf(new URL(staging.url))).toBe(staging.label)
  })
})
