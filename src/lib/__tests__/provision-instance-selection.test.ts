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
    expect(after.instances.prod).toMatchObject({
      url: 'https://prod.example.test/api',
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

  test('replays a ready receipt without selecting it again', async () => {
    const { after, target, result } = await journey('ready-replay')
    expect(after.active).toBe('dev')
    expect(target.url).toBe('https://dev.example.test/api')
    expect(Object.keys(after.instances).sort()).toEqual(['dev', 'prod'])
    expect(result.created.operationId).toBe('fixture.instance.create.retained')
  })

  test.each(['concurrent-selection', 'concurrent-first-target'])(
    'retains the selection another process made during owner activation (%s)',
    async (scenario) => {
      const { after, target } = await journey(scenario)
      expect(after.active).toBe('staging')
      expect(target.url).toBe('https://staging.example.test/api')
      expect(after.instances.prod.url).toBe('https://prod.example.test/api')
    },
  )

  test.each(['pending-access', 'pending-access-collision'])(
    'leaves the catalogue and root identity unchanged until owner access completes (%s)',
    async (scenario) => {
      const { before, after, target, result, events, rootMaterial } = await journey(scenario)
      expect(after.active).toBe(before.active)
      expect(after.instances).toEqual(before.instances)
      expect(target.url).toBe('https://dev.example.test/api')
      expect(result.access.status).toBe('pending')
      expect(events).toEqual(['receipt'])
      expect(rootMaterial).toBe('existing-root-material')
    },
  )

  test.each(['name-collision', 'alias-collision'])(
    'preserves the exact endpoint, aliases and root identity when the created slug is already owned (%s)',
    async (scenario) => {
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
      } = await journey(scenario)
      expect(registryAfter).toBe(registryBefore)
      expect(after.active).toBe(before.active)
      expect(target.url).toBe('https://dev.example.test/api')
      expect(rootMaterial).toBe('existing-root-material')
      expect(events).toEqual(['receipt', 'access'])
      expect(result.created.state).toBe('ready')
      expect(result.access.status).toBe('completed')
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
    },
  )

  test('rechecks a bookmark collision committed by another process during owner activation', async () => {
    const { after, target, result, events, rootMaterial } = await journey('concurrent-collision')
    expect(after.active).toBe('prod')
    expect(target.url).toBe('https://staging.example.test/api')
    expect(after.instances.prod.url).toBe('https://staging.example.test/api')
    expect(result.bookmark.code).toBe('INSTANCE_BOOKMARK_CONFLICT')
    expect(events).toEqual(['receipt', 'access'])
    expect(rootMaterial).toBe('existing-root-material')
  })

  test('preserves an existing root alias for another issuer even without a homonymous bookmark', async () => {
    const { after, target, result, identityProtection, stderr } = await journey(
      'identity-issuer-conflict',
    )
    expect(after.active).toBe('dev')
    expect(target.url).toBe('https://dev.example.test/api')
    expect(result.created.state).toBe('ready')
    expect(result.access.status).toBe('completed')
    expect(result.bookmark.status).toBe('completed')
    expect(result.rootIdentityError.code).toBe('IDENTITY_ISSUER_CONFLICT')
    expect(identityProtection.registryAfterHash).toBe(identityProtection.registryBeforeHash)
    expect(identityProtection.keyAfterHash).toBe(identityProtection.keyBeforeHash)
    expect(identityProtection.incomingKeyPresent).toBe(false)
    expect(JSON.parse(stderr).error).toBe('IDENTITY_ISSUER_CONFLICT')
  })
})
