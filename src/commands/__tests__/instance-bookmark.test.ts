import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli } from './fixtures/process'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-instance-bookmark-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const store = (active: string, instances: Record<string, Record<string, string>>) =>
  writeFile(join(tmp, 'instances.json'), JSON.stringify({ version: 1, active, instances }))

describe('instance bookmark and active commands', () => {
  test('a bookmark of a managed instance root is stored at /api, keeping its optional fields', async () => {
    const recorded = {
      issuer: 'https://issuer.example.com',
      defaultIdentity: 'marc',
      caFile: '/tmp/ca.pem',
      createdAt: '2026-06-10T00:00:00.000Z',
    }
    await store('testmarc', { testmarc: { url: 'https://testmarc.eu.astrale.ai', ...recorded } })

    const args = ['--url', 'https://testmarc.eu.astrale.ai', '--skip-probe']
    const result = await runCli(tmp, ['instance', 'bookmark', 'testmarc', ...args])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Updated bookmark "testmarc"')
    const { instances } = JSON.parse(await readFile(join(tmp, 'instances.json'), 'utf8'))
    expect(instances.testmarc).toMatchObject({
      url: 'https://testmarc.eu.astrale.ai/api',
      ...recorded,
    })
  })

  test('warns when another bookmark uses different TLS trust for the same URL', async () => {
    await store('stable', {
      stable: { url: 'https://local.example/kernel', caFile: '/certs/stable.pem' },
    })

    const args = [
      '--url',
      'https://local.example/kernel/',
      '--ca',
      '/certs/old.pem',
      '--skip-probe',
    ]
    const result = await runCli(tmp, ['instance', 'bookmark', 'stale', ...args])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('TLS trust differs for the same Kernel URL')
    expect(result.stderr).toContain('"stable" uses CA /certs/stable.pem')
  })

  test('active --json exposes the TLS and identity configuration, or a machine failure', async () => {
    const missing = await runCli(tmp, ['instance', 'active', '--json'])
    expect(missing.exitCode).toBe(1)
    expect(JSON.parse(missing.stderr)).toEqual({
      error: 'INSTANCE_NOT_FOUND',
      message: 'No active instance. Run: astrale instance bookmark <name> --url <url> --use',
    })

    const stable = {
      url: 'https://local.example/kernel',
      issuer: 'https://issuer.example',
      defaultIdentity: 'marc',
      caFile: '/certs/stable.pem',
      createdAt: '2026-08-20T00:00:00.000Z',
    }
    await store('stable', { stable })
    const active = await runCli(tmp, ['instance', 'active', '--json'])
    expect(active.exitCode).toBe(0)
    expect(JSON.parse(active.stdout)).toEqual({ name: 'stable', ...stable })
  })
})
