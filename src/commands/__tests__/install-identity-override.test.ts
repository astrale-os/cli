import { defineSchema } from '@astrale-os/sdk/schema'
import { afterAll, describe, expect, test } from 'bun:test'

import { releaseFor } from '../../__tests__/fixtures/publication'
import { installsOnKernel, isUrlReference } from '../domain/install'
import { isIdentityOverride, probeDeclaredOrigin } from '../domain/legacy/identity-override'

describe('install reference classification', () => {
  test('a reference starting with https:// or http:// is a deployment URL', () => {
    expect(isUrlReference('https://crm.acme.dev')).toBe(true)
    expect(isUrlReference('http://localhost:8787')).toBe(true)
  })

  test('anything else is a catalog origin (the unique registry key)', () => {
    expect(isUrlReference('crm.acme.dev')).toBe(false)
    expect(isUrlReference('example.astrale.ai')).toBe(false)
    // A URL is recognized by its written scheme only (AM-58).
    expect(isUrlReference('http:crm.acme.dev')).toBe(false)
    expect(isUrlReference('HTTPS://crm.acme.dev')).toBe(false)
  })

  test('URL references, and every reference passed with --direct, go to the instance Kernel', () => {
    expect(installsOnKernel(['https://a.dev', 'http://localhost:8787'], false)).toBe(true)
    // --direct never lets a reference fall through to the Fleet catalog; the URL install admits
    // or refuses it (an upper-case scheme reached the Kernel before installs were grouped).
    expect(installsOnKernel(['HTTPS://crm.acme.dev'], true)).toBe(true)
    expect(installsOnKernel(['crm.acme.dev'], true)).toBe(true)
    expect(installsOnKernel(['HTTPS://crm.acme.dev'], false)).toBe(false)
    expect(installsOnKernel(['https://a.dev', 'crm.acme.dev'], false)).toBe(false)
    expect(installsOnKernel([], true)).toBe(false)
    expect(installsOnKernel([], false)).toBe(false)
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

  test('does not accept a Publication without the canonical origin field', async () => {
    const invalid = servePublication(() =>
      Response.json({ iss: 'https://x', domainName: 'crm.acme.dev' }),
    )
    expect(await probeDeclaredOrigin(invalid)).toBeUndefined()
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
