import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { fakeAdmin } from '../../admin/catalog/__tests__/fake-admin'

class ExitError extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`process.exit(${String(code)})`)
  }
}

const SHELL = 'https://shell.astrale.ai/.well-known/astrale/domain.json'

/**
 * Admin #446: the core Fleet contains the platform Domain, the tenant Fleet lists it and contains
 * its own Instance.
 */
function mergedAdmin() {
  return fakeAdmin({
    fleets: [
      { id: 'core-fleet', slug: 'default' },
      { id: 'tenant-fleet', slug: 'tenant' },
    ],
    domains: [{ id: 'shell-domain', origin: 'shell.astrale.ai', discoveryUrl: SHELL }],
    instances: [{ id: 'tenant-app', slug: 'tenant-app' }],
    edges: [
      ['fleet_contains', 'core-fleet', 'shell-domain'],
      ['fleet_lists_domain', 'tenant-fleet', 'shell-domain'],
      ['fleet_contains', 'tenant-fleet', 'tenant-app'],
    ],
  })
}

let admin = mergedAdmin()

mock.module('../../connection', () => ({
  runKernelCommand: mock(),
  withAdminClientSession: async (
    _opts: unknown,
    run: (context: { session: unknown; graph: unknown }) => Promise<unknown>,
  ) => run({ session: admin.session, graph: admin.graph }),
}))

let stdout = ''
let stderr = ''
let originalExit: typeof process.exit
let originalStdoutWrite: typeof process.stdout.write
let originalStderrWrite: typeof process.stderr.write

beforeEach(() => {
  admin = mergedAdmin()
  stdout = ''
  stderr = ''
  originalExit = process.exit
  originalStdoutWrite = process.stdout.write.bind(process.stdout)
  originalStderrWrite = process.stderr.write.bind(process.stderr)
  process.exit = ((code?: string | number | null) => {
    throw new ExitError(code)
  }) as typeof process.exit
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  }) as typeof process.stderr.write
})

afterEach(() => {
  process.exit = originalExit
  process.stdout.write = originalStdoutWrite
  process.stderr.write = originalStderrWrite
})

async function publish(opts: Record<string, unknown>): Promise<void> {
  const { default: command } = await import('../domain/publish')
  await command.action({ fleet: '@tenant-fleet', json: true, noPrompt: true, ...opts } as never)
}

describe('Fleet catalog commands on a merged Admin catalog', () => {
  test('domain publish --install-by-default sets the Fleet default with Fleet.configureDomainDefault', async () => {
    await publish({
      origin: 'shell.astrale.ai',
      name: 'shell',
      publicUrl: 'https://shell.astrale.ai',
      installByDefault: true,
    })

    expect(admin.calls).toEqual([
      {
        target: '@tenant-fleet::admin.astrale.ai:class.Fleet.method.configureDomainDefault',
        value: {
          operationId: expect.stringMatching(/^cli\.domain\.configure-default\./u),
          domain: '@shell-domain',
          enabled: true,
        },
      },
    ])
    expect(JSON.parse(stdout)).toMatchObject({
      id: '@shell-domain',
      origin: 'shell.astrale.ai',
      url: SHELL,
      installByDefault: true,
      changed: true,
    })
  })

  test('domain publish of a new origin on a non-core Fleet prints the refusal and exits 1', async () => {
    await expect(
      publish({
        origin: 'crm.acme.dev',
        name: 'crm',
        publicUrl: 'https://crm.acme.dev',
        installByDefault: true,
      }),
    ).rejects.toEqual(new ExitError(1))

    expect(JSON.parse(stderr)).toEqual({
      error: 'CATALOG_ORIGIN_CONFLICT',
      message:
        'Admin refused to catalogue crm.acme.dev in this Fleet: only the core Fleet catalogues a new origin.',
      hint: 'Ask an Astrale operator to publish it in the core Fleet, or install it without the catalog: astrale domain install <url> --direct -i <instance>',
    })
    expect(admin.calls.map(({ target }) => target)).toEqual([
      '@tenant-fleet::admin.astrale.ai:class.Fleet.method.publishDomain',
    ])
    expect(stdout).toBe('')
  })

  test('domain install <origin> -i installs the Domain a non-core Fleet lists', async () => {
    const { installViaAdmin } = await import('../domain/install')
    const instance = {
      id: '@tenant-app',
      slug: 'tenant-app',
      url: 'https://tenant-app.eu.astrale.ai',
      state: 'ready' as const,
    }

    await installViaAdmin(
      'shell.astrale.ai',
      { instance: 'tenant-app', json: true, noPrompt: true },
      {
        listInstances: async () => [instance],
        resolveInstance: async () => instance,
      },
    )

    expect(admin.calls).toEqual([
      {
        target: '@tenant-app::admin.astrale.ai:class.Instance.method.installDomain',
        value: {
          operationId: expect.any(String),
          domain: '@shell-domain',
        },
      },
    ])
    expect(JSON.parse(stdout)).toEqual({
      name: 'shell',
      origin: 'shell.astrale.ai',
      instanceId: 'tenant-app',
      url: SHELL,
      ok: true,
    })
  })
})
