import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

import { FLEET_CATALOG_DEPRECATION } from '../domain/legacy/catalog-deprecation'

/**
 * The Fleet catalog commands (`domain publish`, `domain list`, the bare-origin `domain install`)
 * warn a person that they are deprecated and name their successor. A machine run keeps its stdout
 * and stderr exactly as before: adapter-astrale 0.5.0-beta.148 `ensureServices` runs
 * `--ci --no-prompt domain install services.astrale.ai -i <instance> --json` and reads a failed
 * run's stderr as exactly one JSON value.
 *
 * Each case runs in its own process, so the module replacements stay out of the other suites and
 * `process.stdout.isTTY` can stand for a terminal.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url))
const fleetCatalog = fileURLToPath(new URL('../domain/legacy/fleet-catalog.ts', import.meta.url))
const connection = fileURLToPath(new URL('../../connection/index.ts', import.meta.url))
const listCommand = fileURLToPath(new URL('../domain/list.ts', import.meta.url))
const publishCommand = fileURLToPath(
  new URL('../domain/legacy/catalog-publish.ts', import.meta.url),
)
const catalogInstall = fileURLToPath(
  new URL('../domain/legacy/catalog-install.ts', import.meta.url),
)

const DOMAIN = {
  id: '@crm-domain',
  origin: 'crm.acme.dev',
  name: 'crm',
  url: 'https://crm.acme.dev/.well-known/astrale/domain.json',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
}
const INSTANCE = { id: '@owned', slug: 'owned', url: 'https://owned.eu.astrale.ai', state: 'ready' }

interface Run {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Run `script` in a fresh Bun process; `terminal` makes stdout look like a TTY. */
function run(script: string, terminal: boolean): Run {
  const result = Bun.spawnSync(
    [
      process.execPath,
      '-e',
      `
      import { mock } from 'bun:test'
      globalThis.fetch = async () => { throw new Error('Unexpected network access') }
      process.stdout.isTTY = ${terminal}
      process.stderr.isTTY = false
      mock.module(${JSON.stringify(fleetCatalog)}, () => ({
        listAdminDomains: async () => [${JSON.stringify(DOMAIN)}],
        listAdminDomainsInContext: async () => [${JSON.stringify(DOMAIN)}],
        publishAdminDomain: async () => ({ entry: ${JSON.stringify(DOMAIN)}, changed: true, isNew: true }),
        installAdminDomainInContext: async () => ({
          name: 'crm', origin: 'crm.acme.dev', instanceId: 'owned', url: ${JSON.stringify(DOMAIN.url)}, ok: true,
        }),
      }))
      mock.module(${JSON.stringify(connection)}, () => ({
        withAdminClientSession: async (_options, use) => use({ session: {}, graph: {} }),
      }))
      ${script}
    `,
    ],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  )
  return {
    exitCode: result.exitCode,
    stdout: stripVTControlCharacters(result.stdout.toString()),
    stderr: stripVTControlCharacters(result.stderr.toString()),
  }
}

const listScript = (opts: string) => `
  const { default: command } = await import(${JSON.stringify(listCommand)})
  await command.action(${opts})
`
const publishScript = (opts: string) => `
  const { default: command } = await import(${JSON.stringify(publishCommand)})
  await command.action({ origin: 'crm.acme.dev', name: 'crm', publicUrl: 'https://crm.acme.dev', noPrompt: true, ...${opts} })
`
const installScript = (opts: string) => `
  const { installViaAdmin } = await import(${JSON.stringify(catalogInstall)})
  await installViaAdmin('crm.acme.dev', { instance: 'owned', noPrompt: true, ...${opts} }, {
    listInstances: async () => [${JSON.stringify(INSTANCE)}],
    resolveInstance: async () => (${JSON.stringify(INSTANCE)}),
  })
`

describe('Fleet catalog deprecation', () => {
  test('each notice names the command and its successor', () => {
    expect(FLEET_CATALOG_DEPRECATION).toEqual({
      publish:
        "`astrale domain publish` is deprecated: the Fleet catalog it writes now only keeps a Fleet's default Domains. " +
        'Publish a version with `astrale-domain publish <environment>` in the Domain project.',
      list:
        '`astrale domain list` reads the deprecated Fleet catalog. ' +
        '`astrale domain versions <origin>` lists the published versions of a Domain.',
      install:
        'Installing from the Fleet catalog by origin is deprecated. ' +
        'Install a published version (`astrale domain install <origin>@<version>`) or a deployment URL.',
    })
  })

  test.each([
    ['domain list', listScript('{}'), FLEET_CATALOG_DEPRECATION.list],
    ['domain publish', publishScript('{}'), FLEET_CATALOG_DEPRECATION.publish],
    ['domain install <origin>', installScript('{}'), FLEET_CATALOG_DEPRECATION.install],
  ])('%s warns a person on stderr, before its own output', (_command, script, notice) => {
    const result = run(script, true)
    expect(result.exitCode).toBe(0)
    expect(result.stderr.startsWith(`⚠ ${notice}\n`)).toBe(true)
    expect(result.stdout).not.toContain('deprecated')
  })

  test('domain list still renders the catalog table for a person', () => {
    const result = run(listScript('{}'), true)
    expect(result.stdout).toContain('crm  crm.acme.dev  https://crm.acme.dev')
  })

  test.each(['{ json: true }', '{ ci: true }', '{ raw: true }'])(
    'a machine run (%s) prints no notice and keeps its output',
    (opts) => {
      for (const script of [listScript(opts), publishScript(opts), installScript(opts)]) {
        const result = run(script, true)
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
        expect(result.stdout).toContain(DOMAIN.origin)
      }
    },
  )

  test('--json output is the unchanged machine record of each command', () => {
    expect(JSON.parse(run(listScript('{ json: true }'), true).stdout)).toEqual([DOMAIN])
    expect(JSON.parse(run(publishScript('{ json: true }'), true).stdout)).toEqual({
      ...DOMAIN,
      changed: true,
    })
    expect(JSON.parse(run(installScript('{ json: true }'), true).stdout)).toEqual({
      name: 'crm',
      origin: 'crm.acme.dev',
      instanceId: 'owned',
      url: DOMAIN.url,
      ok: true,
    })
  })

  test('a run without a terminal on stdout prints no notice', () => {
    for (const script of [listScript('{}'), publishScript('{}'), installScript('{}')]) {
      const result = run(script, false)
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
    }
  })

  test('a failed machine install keeps stderr one JSON diagnostic', () => {
    const result = run(
      `
      const { installViaAdmin } = await import(${JSON.stringify(catalogInstall)})
      await installViaAdmin('crm.acme.dev', { instance: 'foreign', json: true, noPrompt: true }, {
        listInstances: async () => [],
        resolveInstance: async () => undefined,
      })
    `,
      true,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: 'INSTANCE_NOT_MANAGED',
      message: 'Instance "foreign" is not available through Admin.',
    })
  })
})
