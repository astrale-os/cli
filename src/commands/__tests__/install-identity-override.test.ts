import { defineSchema } from '@astrale-os/sdk/schema'
import { afterAll, describe, expect, test } from 'bun:test'

import { releaseFor } from '../../__tests__/fixtures/publication'
import { domainRefFromTarget, isIdentityOverride, probeDeclaredOrigin } from '../domain/install'

describe('admin-path target classification', () => {
  test('an http(s) url installs by url', () => {
    expect(domainRefFromTarget('https://crm.acme.dev')).toEqual({ url: 'https://crm.acme.dev' })
    expect(domainRefFromTarget('http://localhost:8787')).toEqual({ url: 'http://localhost:8787' })
  })

  test('a bare origin installs by catalog origin (the unique registry key)', () => {
    expect(domainRefFromTarget('crm.acme.dev')).toEqual({ origin: 'crm.acme.dev' })
    // A host:port that is not a url is still an origin, not a url.
    expect(domainRefFromTarget('example.astrale.ai')).toEqual({ origin: 'example.astrale.ai' })
  })
})

describe('identity-override detection', () => {
  test('origin matching the serving host is not an override', () => {
    expect(isIdentityOverride('crm.acme.dev', 'crm.acme.dev')).toBe(false)
    expect(isIdentityOverride('CRM.Acme.Dev', 'crm.acme.dev')).toBe(false)
  })

  test('origin differing from the serving host is an override', () => {
    // The spec §5 attack shape: a fork on workers.dev claiming a well-known origin.
    expect(isIdentityOverride('shell.astrale.ai', 'crm.workers.dev')).toBe(true)
    // The scaffold default also aliases until the placeholder origin is edited.
    expect(isIdentityOverride('hldom.example.dev', 'hldom-example-dev.acme.workers.dev')).toBe(true)
  })
})

describe('declared-origin Publication probe', () => {
  const servers: { stop(): void }[] = []
  afterAll(() => {
    for (const s of servers) s.stop()
  })

  function servePublication(handler: (req: Request) => Response): string {
    const server = Bun.serve({ port: 0, fetch: handler })
    servers.push(server)
    return `http://localhost:${server.port}`
  }

  test('reads origin from a well-formed canonical Publication', async () => {
    const schema = defineSchema('crm.acme.dev', {})
    const deployed = releaseFor(schema, 'https://crm.acme.dev').publication
    const url = servePublication((req) =>
      new URL(req.url).pathname === '/.well-known/astrale/domain.json'
        ? Response.json(deployed)
        : new Response('nope', { status: 404 }),
    )
    expect(await probeDeclaredOrigin(url)).toBe('crm.acme.dev')
  })

  test('does not accept the removed pre-Kernel-V2 domainName shape', async () => {
    const legacy = servePublication(() =>
      Response.json({ iss: 'https://x', domainName: 'crm.acme.dev' }),
    )
    expect(await probeDeclaredOrigin(legacy)).toBeUndefined()
  })

  test('degrades to undefined on invalid Publication, non-200, bad JSON, or dead host', async () => {
    const noName = servePublication(() => Response.json({ iss: 'https://x' }))
    expect(await probeDeclaredOrigin(noName)).toBeUndefined()

    const error = servePublication(() => new Response('boom', { status: 500 }))
    expect(await probeDeclaredOrigin(error)).toBeUndefined()

    const badJson = servePublication(() => new Response('<html>', { status: 200 }))
    expect(await probeDeclaredOrigin(badJson)).toBeUndefined()

    expect(await probeDeclaredOrigin('http://127.0.0.1:1')).toBeUndefined()
  })
})
