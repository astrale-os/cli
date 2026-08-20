import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cliRoot = join(import.meta.dir, '../../..')

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-instance-bookmark-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('instance bookmark command', () => {
  test('normalizes managed instance public roots to /api when creating a bookmark', async () => {
    const result = await runBookmark(
      'testmarc',
      '--url',
      'https://testmarc.eu.astrale.ai',
      '--skip-probe',
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Bookmarked "testmarc"')

    const store = await readInstances()
    expect(store.instances.testmarc.url).toBe('https://testmarc.eu.astrale.ai/api')
  })

  test('repairs an existing managed-root bookmark without clearing optional fields', async () => {
    await mkdir(tmp, { recursive: true })
    await writeFile(
      join(tmp, 'instances.json'),
      JSON.stringify(
        {
          active: 'testmarc',
          instances: {
            testmarc: {
              url: 'https://testmarc.eu.astrale.ai',
              issuer: 'https://issuer.example.com',
              defaultIdentity: 'marc',
              caFile: '/tmp/ca.pem',
              createdAt: '2026-06-10T00:00:00.000Z',
              kind: 'bookmark',
              mode: 'remote',
            },
          },
        },
        null,
        2,
      ) + '\n',
    )

    const result = await runBookmark(
      'testmarc',
      '--url',
      'https://testmarc.eu.astrale.ai',
      '--skip-probe',
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Updated bookmark "testmarc"')

    const store = await readInstances()
    expect(store.instances.testmarc.url).toBe('https://testmarc.eu.astrale.ai/api')
    expect(store.instances.testmarc.issuer).toBe('https://issuer.example.com')
    expect(store.instances.testmarc.defaultIdentity).toBe('marc')
    expect(store.instances.testmarc.caFile).toBe('/tmp/ca.pem')
    expect(store.instances.testmarc.createdAt).toBe('2026-06-10T00:00:00.000Z')
  })

  test('warns when another bookmark uses different TLS trust for the same URL', async () => {
    await writeFile(
      join(tmp, 'instances.json'),
      JSON.stringify({
        active: 'stable',
        instances: {
          stable: {
            url: 'https://local.example/kernel',
            caFile: '/certs/stable.pem',
          },
        },
      }),
    )

    const result = await runBookmark(
      'stale',
      '--url',
      'https://local.example/kernel/',
      '--ca',
      '/certs/old.pem',
      '--skip-probe',
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('TLS trust differs for the same Kernel URL')
    expect(result.stderr).toContain('"stable" uses CA /certs/stable.pem')
  })

  test('active --json exposes the TLS and identity configuration', async () => {
    await writeFile(
      join(tmp, 'instances.json'),
      JSON.stringify({
        active: 'stable',
        instances: {
          stable: {
            url: 'https://local.example/kernel',
            issuer: 'https://issuer.example',
            defaultIdentity: 'marc',
            caFile: '/certs/stable.pem',
            createdAt: '2026-08-20T00:00:00.000Z',
          },
        },
      }),
    )

    const result = await runCli('instance', 'active', '--json')
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      name: 'stable',
      url: 'https://local.example/kernel',
      issuer: 'https://issuer.example',
      defaultIdentity: 'marc',
      caFile: '/certs/stable.pem',
      createdAt: '2026-08-20T00:00:00.000Z',
    })
  })
})

async function readInstances(): Promise<{
  active: string
  instances: Record<string, Record<string, unknown>>
}> {
  return JSON.parse(await readFile(join(tmp, 'instances.json'), 'utf-8'))
}

async function runBookmark(...args: string[]): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  return runCli('instance', 'bookmark', ...args)
}

async function runCli(...args: string[]): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  const proc = Bun.spawn({
    cmd: ['bun', join(cliRoot, 'bin/astrale.ts'), ...args],
    env: { ...process.env, ASTRALE_HOME: tmp },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}
