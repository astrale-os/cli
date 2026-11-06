import { describe, expect, test } from 'bun:test'

import { AstraleError } from '../../errors'
import {
  findDirectoryInstance,
  readInstanceDirectory,
  type DirectoryDependencies,
  type InstanceDirectory,
} from '../admin/directory'

const TOKEN = 'header.payload.signature-never-printed'
const PACE = {
  organizationId: 'org_01PACE',
  name: 'Pace Logistique',
  url: 'https://pace.eu.astrale.ai',
  slug: 'pace',
  region: 'eu',
}

function dependencies(
  respond: (request: Request) => Response | Promise<Response>,
  seen: Request[] = [],
): DirectoryDependencies {
  return {
    domainIssuer: async () => 'https://admin.astrale.ai',
    token: async () => TOKEN,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      seen.push(request)
      return respond(request)
    }) as typeof fetch,
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

describe('instance directory', () => {
  test('reads the listing at the Admin Domain origin with the sign-in as a bearer', async () => {
    const seen: Request[] = []
    const listing = await readInstanceDirectory(
      {},
      dependencies(() => json(200, { instances: [PACE], truncated: false }), seen),
    )
    expect(listing).toEqual({ instances: [PACE], truncated: false })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.method).toBe('GET')
    expect(seen[0]!.url).toBe('https://admin.astrale.ai/directory/instances')
    expect(seen[0]!.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
  })

  test('drops fields the listing does not promise and keeps an absent region absent', async () => {
    const { region: _region, ...noRegion } = PACE
    const listing = await readInstanceDirectory(
      {},
      dependencies(() =>
        json(200, { instances: [{ ...noRegion, extra: 'x' }], truncated: true, more: 1 }),
      ),
    )
    expect(listing).toEqual({ instances: [noRegion], truncated: true })
  })

  test.each([
    [401, { code: 'DIRECTORY_IDENTITY_REJECTED' }, {}, 'DIRECTORY_IDENTITY_REJECTED', 'auth login'],
    [
      429,
      { code: 'DIRECTORY_RATE_LIMITED' },
      { 'retry-after': '42' },
      'DIRECTORY_RATE_LIMITED',
      '42',
    ],
    [503, { code: 'DIRECTORY_UNAVAILABLE' }, {}, 'DIRECTORY_UNAVAILABLE', '--bookmarked'],
    [
      200,
      { instances: [{ ...PACE, url: 'http://pace.eu.astrale.ai' }], truncated: false },
      {},
      'DIRECTORY_UNAVAILABLE',
      '--bookmarked',
    ],
  ])('HTTP %i becomes a readable failure', async (status, body, headers, code, hint) => {
    const failure = await readInstanceDirectory(
      {},
      dependencies(() => json(status, body, headers)),
    )
      .then(() => undefined)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AstraleError)
    expect(failure).toMatchObject({ code, hint: expect.stringContaining(hint) })
    expect(JSON.stringify(failure)).not.toContain(TOKEN)
    expect((failure as Error).message).not.toContain(TOKEN)
  })

  test('a network failure says the directory is unavailable, never the token', async () => {
    const failure = await readInstanceDirectory(
      {},
      dependencies(() => {
        throw new TypeError(`fetch failed for ${TOKEN}`)
      }),
    ).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'DIRECTORY_UNAVAILABLE' })
    expect((failure as Error).message).not.toContain(TOKEN)
  })

  test('refuses an Admin Domain issuer that is not https, except on this computer', async () => {
    let fetched = 0
    const plain: DirectoryDependencies = {
      ...dependencies(() => (fetched++, json(200, { instances: [], truncated: false }))),
      domainIssuer: async () => 'http://admin.example.com',
    }
    await expect(readInstanceDirectory({}, plain)).rejects.toMatchObject({
      code: 'DIRECTORY_UNAVAILABLE',
    })
    expect(fetched).toBe(0)
    const local: DirectoryDependencies = {
      ...plain,
      domainIssuer: async () => 'http://localhost:8787',
    }
    await expect(readInstanceDirectory({}, local)).resolves.toEqual({
      instances: [],
      truncated: false,
    })
  })

  test('a slug names one instance; two instances with one slug are refused', () => {
    const directory: InstanceDirectory = {
      instances: [PACE, { ...PACE, organizationId: 'org_02', url: 'https://pace.us.astrale.ai' }],
      truncated: false,
    }
    expect(findDirectoryInstance({ ...directory, instances: [PACE] }, 'pace')).toEqual(PACE)
    expect(findDirectoryInstance(directory, 'other')).toBeUndefined()
    expect(() => findDirectoryInstance(directory, 'pace')).toThrow(
      expect.objectContaining({ code: 'INSTANCE_AMBIGUOUS' }),
    )
  })
})
