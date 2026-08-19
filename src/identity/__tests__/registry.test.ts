import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('identity registry journey', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'astrale-identity-registry-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** @evidence TEST-CLI-IDENTITY-REGISTRY-JOURNEY */
  test('runs create, selection, registration, mode, IdP, and deletion in a real process', async () => {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'fixtures', 'registry-journey.ts')],
      {
        env: { ...process.env, ASTRALE_HOME: root },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode, stderr).toBe(0)

    const result = JSON.parse(stdout) as {
      store: {
        default: string
        identities: Record<
          string,
          {
            source?: string
            mode?: string
            registrations?: Record<string, { iss: string; sub: string; registeredAt: string }>
          }
        >
      }
      selected: { name: string; subject: string }
      selectedDeletion: string
      aliceKey: boolean
      bobKey: boolean
    }
    expect(result.store.default).toBe('alice')
    expect(Object.keys(result.store.identities).sort()).toEqual(['alice', 'workos'])
    expect(result.store.identities.alice.registrations?.production).toEqual({
      iss: 'https://kernel.example',
      sub: 'node-alice',
      registeredAt: '2026-08-11T12:00:00.000Z',
    })
    expect(result.store.identities.workos).toMatchObject({ source: 'idp', mode: 'remote' })
    expect(result.selected).toMatchObject({ name: 'alice', subject: 'alice' })
    expect(result.selectedDeletion).toContain('Cannot delete the default identity')
    expect(result.aliceKey).toBe(true)
    expect(result.bobKey).toBe(false)

    const persisted = JSON.parse(await readFile(join(root, 'identities.json'), 'utf-8')) as {
      version?: unknown
    }
    expect(persisted.version).toBe(1)
    expect(stdout).not.toContain('"d":')
  })
})
