import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  IDENTITY_STORE_VERSION,
  IdentityStateError,
  readIdentityStore,
  updateIdentityStore,
  type IdentityStore,
} from '../identities'

let directory: string
let path: string

const legacy = JSON.stringify(
  {
    default: 'manager',
    identities: {
      manager: {
        subject: 'manager',
        createdAt: '2024-01-01T00:00:00.000Z',
        source: 'key',
        mode: 'local',
      },
    },
  },
  null,
  2,
)

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'astrale-identity-state-'))
  path = join(directory, 'identities.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('identity state', () => {
  /** @evidence TEST-CLI-STATE-IDENTITY-READ-SAFE */
  test('reads missing, legacy, and current state without writing', async () => {
    const missing = await readIdentityStore({
      path,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    })
    expect(missing).toEqual({ default: '', identities: {} })
    await expect(readFile(path, 'utf-8')).rejects.toThrow()

    await writeFile(path, legacy)
    expect((await readIdentityStore({ path })).default).toBe('manager')
    expect(await readFile(path, 'utf-8')).toBe(legacy)
    await expect(readFile(`${path}.v0.bak`, 'utf-8')).rejects.toThrow()

    const current = `${JSON.stringify({ version: IDENTITY_STORE_VERSION, ...missing })}\n`
    await writeFile(path, current)
    expect((await readIdentityStore({ path })).identities).toEqual({})
    expect(await readFile(path, 'utf-8')).toBe(current)
  })

  /** @evidence TEST-CLI-STATE-IDENTITY-FAILS-CLOSED */
  test('rejects malformed and unsupported state without replacing it', async () => {
    for (const raw of ['{', JSON.stringify({ version: 2, default: 'manager', identities: {} })]) {
      await writeFile(path, raw)
      const error = await readIdentityStore({ path }).catch((caught) => caught)
      expect(error).toBeInstanceOf(IdentityStateError)
      expect((error as IdentityStateError).code).toBe(
        raw === '{' ? 'IDENTITY_STATE_INVALID' : 'IDENTITY_STATE_VERSION_UNSUPPORTED',
      )
      expect(await readFile(path, 'utf-8')).toBe(raw)
    }
  })

  /** @evidence TEST-CLI-STATE-IDENTITY-MIGRATES */
  test('backs up exact legacy bytes before the first V1 mutation', async () => {
    await writeFile(path, legacy)

    await updateIdentityStore(
      (current) => ({ next: { ...current, default: 'alice' }, value: undefined }),
      { path },
    )

    expect(await readFile(`${path}.v0.bak`, 'utf-8')).toBe(legacy)
    expect((await stat(`${path}.v0.bak`)).mode & 0o777).toBe(0o600)
    const written = JSON.parse(await readFile(path, 'utf-8')) as {
      version: number
      default: string
    }
    expect(written).toMatchObject({ version: 1, default: 'alice' })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  /** @evidence TEST-CLI-STATE-IDENTITY-CONCURRENT */
  test('retains concurrent selection and registration from separate processes', async () => {
    const alice = {
      subject: 'alice',
      createdAt: '2025-01-01T00:00:00.000Z',
      source: 'key' as const,
      mode: 'local' as const,
    }
    const bob = { ...alice, subject: 'bob' }
    await writeFile(
      path,
      JSON.stringify({
        version: IDENTITY_STORE_VERSION,
        default: 'manager',
        identities: {
          manager: { ...alice, subject: 'manager' },
          alice,
          bob,
        },
      }),
    )
    const fixture = join(import.meta.dir, 'fixtures', 'identity-transition.ts')
    const commands = [
      ['default', 'alice'],
      ...Array.from({ length: 8 }, (_, index) => ['registration', 'bob', `instance-${index}`]),
    ]
    const processes = commands.map((args) =>
      Bun.spawn({
        cmd: ['bun', fixture, ...args],
        env: { ...process.env, ASTRALE_HOME: directory },
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    )
    const outcomes = await Promise.all(
      processes.map(async (process) => ({
        code: await process.exited,
        stderr: await new Response(process.stderr).text(),
      })),
    )
    expect(outcomes).toEqual(outcomes.map(() => ({ code: 0, stderr: '' })))

    const store: IdentityStore = await readIdentityStore({ path })
    expect(store.default).toBe('alice')
    expect(Object.keys(store.identities.bob.registrations ?? {})).toHaveLength(8)
    await expect(readFile(`${path}.lock`, 'utf-8')).rejects.toThrow()
  })
})
