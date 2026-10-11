import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SCAFFOLDER, SCAFFOLDER_RANGE } from '../../lib/scaffolder'
import {
  type DomainSetupDependencies,
  domainStep,
  ensureDomainProject,
  scaffoldArgs,
} from '../steps/domain'

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function dependencies(overrides: Partial<DomainSetupDependencies> = {}) {
  const calls: string[][] = []
  const deps: DomainSetupDependencies = {
    hasDomainProject: () => false,
    confirmScaffold: mock(async () => true),
    promptName: mock(async () => 'crm'),
    scaffold: mock(async (args: string[]) => {
      calls.push(args)
      return 0
    }),
    ...overrides,
  }
  return { deps, calls }
}

function printed(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => call.map(String).join(' ').replace(ANSI, ''))
}

const spies: { mockRestore(): void }[] = []
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore()
})

function captureLog() {
  const spy = spyOn(console, 'log').mockImplementation(() => {})
  spies.push(spy)
  return spy
}

describe('setup domain step', () => {
  // The floor: the last create-astrale-domain release that still requires --instance in
  // non-interactive managed mode, and the first that does not (sdk#598). Both are published.
  const LAST_REQUIRING_INSTANCE = '0.3.0-beta.162'
  const FIRST_WITHOUT_INSTANCE = '0.3.0-beta.163'

  test('the scaffolder range starts at the first scaffolder whose managed scaffold names no instance', () => {
    expect(scaffoldArgs('crm')).toEqual([`create-astrale-domain@${SCAFFOLDER_RANGE}`, 'crm'])
    expect(SCAFFOLDER_RANGE).toBe(`>=${FIRST_WITHOUT_INSTANCE}`)
    // Older scaffolders require --instance, and the unpinned `latest` (0.2.13) is the 0.4 SDK
    // line; a prerelease of another line never matches (npm semver).
    for (const version of ['0.2.13', '0.3.0-beta.0', LAST_REQUIRING_INSTANCE, '0.4.0-beta.0']) {
      expect(Bun.semver.satisfies(version, SCAFFOLDER_RANGE)).toBe(false)
    }
    for (const version of [FIRST_WITHOUT_INSTANCE, '0.3.0']) {
      expect(Bun.semver.satisfies(version, SCAFFOLDER_RANGE)).toBe(true)
    }
  })

  test('scaffolds without --instance, then deploys development and installs the printed URL', async () => {
    const log = captureLog()
    const { deps, calls } = dependencies()

    await expect(ensureDomainProject(deps)).resolves.toBe('fixed')

    expect(calls).toEqual([[SCAFFOLDER, 'crm']])
    const lines = printed(log)
    expect(lines).toContain('  Next: cd crm && pnpm install && pnpm run deploy development')
    expect(lines).toContain(
      '  Then: astrale domain install <url> -i <instance>   # the URL the deploy prints',
    )
    expect(lines.join('\n')).not.toContain('--instance')
  })

  test('a failed scaffold prints no Next steps', async () => {
    const log = captureLog()
    spies.push(spyOn(console, 'error').mockImplementation(() => {}))

    await expect(
      ensureDomainProject(dependencies({ scaffold: mock(async () => 1) }).deps),
    ).resolves.toBe('failed')
    expect(printed(log).some((line) => line.includes('Next:'))).toBe(false)
  })

  test('the FIX hint names the range and no instance', async () => {
    const log = captureLog()
    await expect(
      ensureDomainProject(dependencies({ confirmScaffold: mock(async () => false) }).deps),
    ).resolves.toBe('skipped')
    expect(printed(log)).toContain(`  Skipped — scaffold later: npx "${SCAFFOLDER}" <name>`)

    const cwd = process.cwd()
    const empty = mkdtempSync(join(tmpdir(), 'setup-domain-step-'))
    try {
      process.chdir(empty)
      await expect(domainStep.detect({} as never)).resolves.toEqual({
        state: 'gap',
        summary: 'no domain project here',
        fixHint: `npx "${SCAFFOLDER}" <name>`,
      })
    } finally {
      process.chdir(cwd)
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
