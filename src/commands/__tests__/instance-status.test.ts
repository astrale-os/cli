import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { InstanceInfo } from '../../lib/admin-instance'
import type { ResolvedInstance } from '../../lib/instance'

import { resolveStatus, type StatusDependencies } from '../instance/status'

const cliRoot = join(import.meta.dir, '../../..')

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
  test('keeps managed lifecycle authoritative when the slug is also bookmarked', async () => {
    const managed: InstanceInfo = {
      id: '@managed',
      slug: 'shared',
      url: 'https://managed.example.com',
      state: 'provisioning',
      phase: 'bootstrap',
    }
    const statusOwnedInstance: StatusDependencies['statusOwnedInstance'] = mock(async () => managed)
    const resolveInstance: StatusDependencies['resolveInstance'] = mock(async () => {
      throw new Error('bookmark resolution must not run')
    })
    const probeBookmark: StatusDependencies['probeBookmark'] = mock(async () => {
      throw new Error('bookmark probe must not run')
    })

    await expect(
      resolveStatus('shared', {}, { statusOwnedInstance, resolveInstance, probeBookmark }),
    ).resolves.toEqual(managed)
    expect(statusOwnedInstance).toHaveBeenCalledWith({}, 'shared')
    expect(resolveInstance).not.toHaveBeenCalled()
    expect(probeBookmark).not.toHaveBeenCalled()
  })

  test('probes only an explicitly selected bookmark and rejects mixed source flags', async () => {
    const bookmark: ResolvedInstance = {
      name: 'local',
      kind: 'bookmark',
      url: 'https://local.example.com',
      issuer: 'https://issuer.example.com',
    }
    const statusOwnedInstance: StatusDependencies['statusOwnedInstance'] = mock(async () => {
      throw new Error('managed status must not run')
    })
    const resolveInstance: StatusDependencies['resolveInstance'] = mock(async () => bookmark)
    const probeBookmark: StatusDependencies['probeBookmark'] = mock(async () => undefined)
    const dependencies = { statusOwnedInstance, resolveInstance, probeBookmark }

    await expect(resolveStatus('local', { bookmarked: true }, dependencies)).resolves.toEqual({
      slug: 'local',
      url: bookmark.url,
      issuer: 'https://issuer.example.com',
      kind: 'bookmark',
      state: 'ready',
    })
    expect(resolveInstance).toHaveBeenCalledWith('local', undefined, { persist: false })
    expect(probeBookmark).toHaveBeenCalledWith(bookmark)
    expect(statusOwnedInstance).not.toHaveBeenCalled()

    await expect(
      resolveStatus('local', { bookmarked: true, admin: 'admin' }, dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_FLAG' })
  })

  test('probes an explicit local bookmark without rewriting its registry', async () => {
    const issuer = `http://127.0.0.1:${server.port}`
    const registry = `${JSON.stringify({
      active: 'local',
      instances: {
        local: {
          url: issuer,
          issuer,
          mode: 'remote',
        },
      },
    })}\n`
    const path = join(home, 'instances.json')
    await writeFile(path, registry)

    const process = Bun.spawn({
      cmd: [
        'bun',
        join(cliRoot, 'bin/astrale.ts'),
        'instance',
        'status',
        'local',
        '--bookmarked',
        '--json',
      ],
      env: { ...Bun.env, ASTRALE_HOME: home },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])

    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      slug: 'local',
      url: issuer,
      issuer,
      kind: 'bookmark',
      state: 'ready',
    })
    expect(await readFile(path, 'utf8')).toBe(registry)
  })
})
