import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temporary: string[] = []
const fixture = new URL('./provision-instance-selection.fixture.ts', import.meta.url).pathname

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function journey(scenario: string) {
  const home = await mkdtemp(join(tmpdir(), 'astrale-instance-create-selection-'))
  temporary.push(home)
  const child = Bun.spawn([process.execPath, fixture, scenario], {
    env: {
      ...process.env,
      ASTRALE_HOME: home,
      ASTRALE_KEYS_DIR: join(home, 'keys'),
      ASTRALE_DATA_DIR: join(home, 'data'),
      ASTRALE_TELEMETRY: '0',
      ASTRALE_TELEMETRY_NO_TRIGGER: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => child.kill(), 5000)
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, stderr).toBe(0)
    return { ...JSON.parse(stdout), stderr }
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) {
      child.kill()
      await child.exited
    }
  }
}

describe('instance creation catalogue ownership', () => {
  test('preserves the existing active endpoint while bookmarking the created instance', async () => {
    const { after, target, result, events } = await journey('existing-target')
    expect(after.active).toBe('dev')
    expect(target.url).toBe('https://dev.example.test/api')
    // A managed bookmark names its Kernel URL as its issuer.
    expect(after.instances.prod).toMatchObject({
      url: 'https://prod.example.test/api',
      issuer: 'https://prod.example.test/api',
      organizationId: 'org_fixture',
    })
    expect(result.access.status).toBe('completed')
    expect(events).toEqual(['receipt', 'access', 'root'])
  })

  test('selects the first instance through the real initial setup journey after owner access', async () => {
    const { before, after, target, setupOutcome, result } = await journey('first-setup')
    expect(before.active).toBe('')
    expect(after.active).toBe('prod')
    expect(target.url).toBe('https://prod.example.test/api')
    expect(setupOutcome).toBe('fixed')
    expect(result.access.status).toBe('completed')
  })

  test('retains the selection another process made during owner activation', async () => {
    const { after, target } = await journey('concurrent-selection')
    expect(after.active).toBe('staging')
    expect(target.url).toBe('https://staging.example.test/api')
    expect(after.instances.prod.url).toBe('https://prod.example.test/api')
  })

  test('leaves the catalogue and root identity unchanged until owner access completes', async () => {
    const { before, after, target, result, events, rootMaterial } = await journey('pending-access')
    expect(after.active).toBe(before.active)
    expect(after.instances).toEqual(before.instances)
    expect(target.url).toBe('https://dev.example.test/api')
    expect(result.access.status).toBe('pending')
    expect(events).toEqual(['receipt'])
    expect(rootMaterial).toBe('existing-root-material')
  })

  test('preserves the exact endpoint, aliases and root identity when the created slug is owned', async () => {
    const {
      before,
      after,
      target,
      result,
      events,
      registryBefore,
      registryAfter,
      rootMaterial,
      stderr,
    } = await journey('name-collision')
    expect(registryAfter).toBe(registryBefore)
    expect(after.active).toBe(before.active)
    expect(target.url).toBe('https://dev.example.test/api')
    expect(rootMaterial).toBe('existing-root-material')
    expect(events).toEqual(['receipt', 'access'])
    expect(result.bookmark).toMatchObject({
      status: 'pending',
      code: 'INSTANCE_BOOKMARK_CONFLICT',
    })
    expect(result.bookmark.hint).toContain(
      "astrale instance bookmark <new-name> --url 'https://prod.example.test/api'",
    )
    expect(JSON.parse(stderr)).toMatchObject({
      error: 'INSTANCE_BOOKMARK_CONFLICT',
      hint: result.bookmark.hint,
    })
  })
})
