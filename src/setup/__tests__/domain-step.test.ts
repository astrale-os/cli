import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SCAFFOLDER, SCAFFOLDER_RANGE } from '../../lib/scaffolder'
import {
  type DomainSetupDependencies,
  domainStep,
  ensureDomainProject,
  nextSteps,
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
  test('scaffolds with the shared range and never passes --instance', () => {
    expect(scaffoldArgs('crm')).toEqual([`create-astrale-domain@${SCAFFOLDER_RANGE}`, 'crm'])
    expect(scaffoldArgs('crm')).toEqual([SCAFFOLDER, 'crm'])
  })

  // The floor: the last create-astrale-domain release that still requires --instance in
  // non-interactive managed mode, and the first that does not (the first release carrying sdk#598,
  // S8). The first is published (0.3.0-beta.159 still requires the flag); the second is a
  // placeholder until that release is cut: C10 merges only once both name published versions,
  // SCAFFOLDER_RANGE starts at the second, and the merge gate confirms them on npm.
  const LAST_REQUIRING_INSTANCE = '0.3.0-beta.159'
  const FIRST_WITHOUT_INSTANCE = '0.3.0-beta.160'

  test('the range starts at the first scaffolder whose managed scaffold names no instance', () => {
    expect(SCAFFOLDER_RANGE).toBe(`>=${FIRST_WITHOUT_INSTANCE}`)
    // Older scaffolders require --instance, and the unpinned `latest` (0.2.13) is the 0.4 SDK
    // line: none may be resolved.
    for (const version of ['0.2.13', '0.3.0-beta.0', LAST_REQUIRING_INSTANCE]) {
      expect(Bun.semver.satisfies(version, SCAFFOLDER_RANGE)).toBe(false)
    }
    for (const version of [FIRST_WITHOUT_INSTANCE, '0.3.0']) {
      expect(Bun.semver.satisfies(version, SCAFFOLDER_RANGE)).toBe(true)
    }
    // A prerelease of another line never matches (npm semver): moving the scaffolder off the
    // 0.3.0 prerelease line means bumping the range in the same CLI release.
    expect(Bun.semver.satisfies('0.4.0-beta.0', SCAFFOLDER_RANGE)).toBe(false)
  })

  test('the argv names no instance', async () => {
    captureLog()
    const { deps, calls } = dependencies()

    await expect(ensureDomainProject(deps)).resolves.toBe('fixed')

    expect(calls).toEqual([[SCAFFOLDER, 'crm']])
    expect(calls[0]!.some((arg) => arg === '--instance' || arg.startsWith('--instance='))).toBe(
      false,
    )
  })

  test('Next deploys development, then installs the printed URL on an <instance>', async () => {
    const log = captureLog()
    await ensureDomainProject(dependencies().deps)
    const lines = printed(log)

    expect(lines).toContain('  Next: cd crm && pnpm install && pnpm run deploy development')
    expect(lines).toContain(
      '  Then: astrale domain install <url> --direct -i <instance>   # the URL the deploy prints',
    )
    expect(lines.join('\n')).not.toContain('pnpm prod')
    expect(lines.join('\n')).not.toContain('--instance')
    expect(nextSteps('crm')).toEqual([
      'cd crm && pnpm install && pnpm run deploy development',
      'astrale domain install <url> --direct -i <instance>',
    ])
  })

  test('a failed scaffold prints no Next steps', async () => {
    const log = captureLog()
    const warn = spyOn(console, 'error').mockImplementation(() => {})
    spies.push(warn)

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
