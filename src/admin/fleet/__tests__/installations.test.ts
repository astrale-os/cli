import type { Call } from '@astrale-os/sdk/client'
import type { InstalledPin } from '@astrale-os/sdk/client/schema'

import { ResponseError } from '@astrale-os/sdk/client'
import { describe, expect, test } from 'bun:test'

import { AstraleError } from '../../../errors'
import { RegistryError } from '../../registry/model'
import { connectAdminFleet, MAXIMUM_RELEASE_FILTER, releaseFilter } from '../installations'

const ORIGIN = 'issues.astrale.ai'
const R1 = `sha256:${'1'.repeat(64)}` as const
const B1 = `sha256:${'b'.repeat(64)}` as const
const ETAG = `sha256:${'e'.repeat(64)}` as const

/** One installation as Admin answers it; the invalid-page case passes a malformed pin on purpose. */
function installation(slug: string, pin: unknown = { kind: 'release', release: R1, build: B1 }) {
  return {
    fleet: '@fleet-acme',
    instance: { id: `@instance-${slug}`, slug },
    pin: pin as InstalledPin,
    url: 'https://issues-staging-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb.deployments.astrale.ai',
  }
}

/** A session whose `call` answers each request with the next page (or throws it). */
function session(pages: readonly unknown[]) {
  const calls: Array<{ readonly target: string; readonly input: unknown }> = []
  return {
    calls,
    context: {
      session: {
        call: async (request: Call) => {
          calls.push({ target: String(request.target), input: request.input })
          const page = pages[calls.length - 1]
          if (page instanceof Error) throw page
          if (page === undefined) throw new Error('no more pages')
          return page
        },
      },
    } as never,
  }
}

async function refusal(promise: Promise<unknown>): Promise<AstraleError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AstraleError)
    return error as AstraleError
  }
  throw new Error('expected a refusal')
}

describe('Fleet installations (CT37)', () => {
  test('calls the static Method and joins every page, following the cursor', async () => {
    const fake = session([
      {
        installations: [installation('acme-prod')],
        unreachable: [{ instance: '@instance-acme-117', reason: 'unsupported' }],
        cursor: 'page-2',
      },
      {
        installations: [installation('acme-stg', { kind: 'legacy', document: 3, etag: ETAG })],
        unreachable: [{ instance: '@instance-acme-down', reason: 'timeout' }],
        // A later Admin may add fields; the CLI ignores them.
        partial: false,
      },
    ])
    const listing = await connectAdminFleet(fake.context).installations(ORIGIN)
    expect(fake.calls).toEqual([
      { target: '/:admin.astrale.ai:class.Fleet:installations', input: { origin: ORIGIN } },
      {
        target: '/:admin.astrale.ai:class.Fleet:installations',
        input: { origin: ORIGIN, cursor: 'page-2' },
      },
    ])
    expect(listing).toEqual({
      format: 'astrale.fleet-installations',
      version: 1,
      origin: ORIGIN,
      fleetView: true,
      installations: [
        installation('acme-prod'),
        installation('acme-stg', { kind: 'legacy', document: 3, etag: ETAG }),
      ],
      // Unknown, never "not installed": both stay visible with their reason (AM-198).
      unreachable: [
        { instance: '@instance-acme-117', reason: 'unsupported' },
        { instance: '@instance-acme-down', reason: 'timeout' },
      ],
    })
  })

  test('a release filter is sent as release digests and echoed in the document', async () => {
    const fake = session([{ installations: [installation('acme-prod')], unreachable: [] }])
    const listing = await connectAdminFleet(fake.context).installations(ORIGIN, {
      releases: [R1, R1],
    })
    expect(fake.calls[0]!.input).toEqual({ origin: ORIGIN, releases: [R1] })
    expect(listing.releases).toEqual([R1])
  })

  test("Admin's 2004 is no Fleet view, not an error (AM-198)", async () => {
    const fake = session([new ResponseError(2004 as never, 'ACCESS_DENIED', 'inv' as never)])
    expect(await connectAdminFleet(fake.context).installations(ORIGIN)).toEqual({
      format: 'astrale.fleet-installations',
      version: 1,
      origin: ORIGIN,
      fleetView: false,
      installations: [],
      unreachable: [],
    })
  })

  test('a member who administers no Fleet has a view and empty lists', async () => {
    const fake = session([{ installations: [], unreachable: [] }])
    const listing = await connectAdminFleet(fake.context).installations(ORIGIN)
    expect(listing.fleetView).toBe(true)
    expect(listing.installations).toEqual([])
  })

  test('an Admin without Fleet.installations is unavailable, never an absent Domain', async () => {
    for (const code of [3001, 3002]) {
      const fake = session([new ResponseError(code as never, 'NOT_FOUND', 'inv' as never)])
      const error = await refusal(connectAdminFleet(fake.context).installations(ORIGIN))
      expect(error.code).toBe('REGISTRY_UNAVAILABLE')
      expect((error as RegistryError).details).toEqual({ status: code, reason: 'unsupported' })
    }
  })

  test('other refusals keep the registry vocabulary', async () => {
    const fake = session([new ResponseError(2001 as never, 'AUTH_INVALID', 'inv' as never)])
    const error = await refusal(connectAdminFleet(fake.context).installations(ORIGIN))
    expect(error.code).toBe('REGISTRY_FORBIDDEN')
  })

  test('an invalid page or a cursor given twice is refused, never half-read', async () => {
    const answers: unknown[][] = [
      [
        {
          installations: [installation('x', { kind: 'release', release: 'sha256:short' })],
          unreachable: [],
        },
      ],
      [{ installations: [], unreachable: [{ instance: '@i', reason: 'not-installed' }] }],
      [{ installations: [installation('x')] }],
      [{ installations: [{ ...installation('x'), url: 'ftp://x' }], unreachable: [] }],
      [
        { installations: [], unreachable: [], cursor: 'again' },
        { installations: [], unreachable: [], cursor: 'again' },
      ],
    ]
    for (const pages of answers) {
      const error = await refusal(connectAdminFleet(session(pages).context).installations(ORIGIN))
      expect(error).toBeInstanceOf(RegistryError)
      expect(error.code).toBe('REGISTRY_UNAVAILABLE')
      expect((error as RegistryError).details).toEqual({ reason: 'response-invalid' })
    }
  })

  test('the release filter is admitted before any request', () => {
    expect(releaseFilter([R1, R1])).toEqual([R1])
    for (const input of [
      [],
      ['sha256:ABC'],
      ['1.5.0'],
      Array.from(
        { length: MAXIMUM_RELEASE_FILTER + 1 },
        (_, i) => `sha256:${i.toString(16).padStart(64, '0')}`,
      ),
    ]) {
      expect(() => releaseFilter(input)).toThrow(AstraleError)
    }
  })
})
