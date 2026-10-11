import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { InstanceInfo } from '../../admin/instance'
import type { ResolvedInstance } from '../../lib/instance/bookmarks'

import { resolveStatus, type StatusDependencies } from '../instance/status'
import { runCli } from './fixtures/process'

let home: string
let server: ReturnType<typeof Bun.serve>

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'astrale-instance-status-'))
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      const issuer = `http://127.0.0.1:${server.port}`
      if (url.pathname === '/.well-known/openid-configuration') {
        return Response.json({ issuer, jwks_uri: `${issuer}/.well-known/jwks.json` })
      }
      if (url.pathname === '/.well-known/jwks.json') {
        return Response.json({ keys: [{ kid: 'status-test' }] })
      }
      return new Response('Not found', { status: 404 })
    },
  })
})

afterEach(async () => {
  server.stop(true)
  await rm(home, { recursive: true, force: true })
})

describe('instance status', () => {
  /** Status dependencies that fail when used, unless a test provides them. */
  const dependencies = (provided: Partial<StatusDependencies>): StatusDependencies => {
    const refuse = (name: string) =>
      mock(async () => {
        throw new Error(`${name} must not run`)
      })
    return {
      statusOwnedInstance: refuse('managed status'),
      resolveInstance: refuse('bookmark resolution'),
      probeBookmark: refuse('bookmark probe'),
      ...provided,
    }
  }

  test('keeps managed lifecycle authoritative when the slug is also bookmarked', async () => {
    const managed: InstanceInfo = {
      id: '@managed',
      slug: 'shared',
      url: 'https://managed.example.com',
      state: 'provisioning',
      phase: 'bootstrap',
    }
    const deps = dependencies({ statusOwnedInstance: mock(async () => managed) })
    expect(await resolveStatus('shared', {}, deps)).toEqual(managed)
    expect(deps.statusOwnedInstance).toHaveBeenCalledWith({}, 'shared')
  })

  test('probes only an explicitly selected bookmark and rejects mixed source flags', async () => {
    const bookmark: ResolvedInstance = {
      name: 'local',
      kind: 'bookmark',
      url: 'https://local.example.com',
      issuer: 'https://issuer.example.com',
    }
    const deps = dependencies({
      resolveInstance: mock(async () => bookmark),
      probeBookmark: mock(async () => undefined),
    })

    expect(await resolveStatus('local', { bookmarked: true }, deps)).toEqual({
      slug: 'local',
      url: bookmark.url,
      issuer: 'https://issuer.example.com',
      kind: 'bookmark',
      state: 'ready',
    })
    expect(deps.probeBookmark).toHaveBeenCalledWith(bookmark)
    await expect(
      resolveStatus('local', { bookmarked: true, admin: 'admin' }, deps),
    ).rejects.toMatchObject({ code: 'INVALID_FLAG' })
  })

  test('probes an explicit local bookmark without rewriting its registry', async () => {
    const issuer = `http://127.0.0.1:${server.port}`
    const local = { url: issuer, issuer, mode: 'remote' }
    const registry = `${JSON.stringify({ version: 1, active: 'local', instances: { local } })}\n`
    const path = join(home, 'instances.json')
    await writeFile(path, registry)

    const result = await runCli(home, ['instance', 'status', 'local', '--bookmarked', '--json'])

    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      slug: 'local',
      url: issuer,
      issuer,
      kind: 'bookmark',
      state: 'ready',
    })
    expect(await readFile(path, 'utf8')).toBe(registry)
  })
})
