import type { CommandDefinition } from '../program/index'

import pkg from '../../package.json' with { type: 'json' }
import { fatal, log } from '../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../lib/output'
import { confirmDefaultYes } from '../lib/prompt'
import {
  applySdkUpdate,
  findSdkOutdated,
  foreignPackageManager,
  inDomainProject,
  type SdkOutdated,
} from '../lib/sdk-deps'
import { ASTRALE_CLI_SKILL, detectSkill, installSkills, SKILL_INSTALL_HINT } from '../lib/skills'
import { updateAstrale } from '../lib/update'

type UpdateOpts = RawOutputOpts & {
  check?: boolean
  channel?: string
  version?: string
  skills?: boolean
  deps?: boolean
  yes?: boolean
}

/**
 * Refresh the astrale agent skills alongside the binary. Delegates to the same
 * `npx skills add` installer `astrale setup` uses; re-running it updates an
 * existing install to the latest published SKILL.md.
 *
 * Only refreshes skills the user already has — `astrale update` keeps an existing
 * install current, it does not foist skills on a non-agent user; fresh installs
 * go through `astrale setup`. Best-effort: a failure here never fails the update
 * (the binary is already swapped), so we warn and move on.
 */
async function refreshSkills(): Promise<void> {
  if (!detectSkill(ASTRALE_CLI_SKILL).installed) {
    log.dim(`  Agent skills not installed — get them with: ${SKILL_INSTALL_HINT}`)
    return
  }
  log.step(`Refreshing the astrale agent skills — ${SKILL_INSTALL_HINT}`)
  if (await installSkills()) {
    log.success('astrale agent skills up to date')
  } else {
    log.warn(`Skill refresh did not complete — run it later: ${SKILL_INSTALL_HINT}`)
  }
}

/**
 * Keep the project's first-party `@astrale-os/*` dependencies current by
 * delegating to pnpm (`pnpm outdated` to detect, `pnpm update --latest` to
 * apply). Runs only inside a domain project (the `astrale.config.ts` marker) and
 * only when pnpm owns it; elsewhere it's a silent no-op. On a dry run (`check`)
 * it only reports. Otherwise it lists the available bumps and applies them behind
 * a single confirm — pnpm rewrites package.json AND the lockfile (no build scripts
 * run; the user runs `pnpm install` to materialize). Returns true when bumps were
 * available (so `--check` can exit 10). Best-effort: pnpm missing or any error
 * surfaces as "up to date".
 */
async function refreshSdkDeps(check: boolean, assumeYes = false): Promise<boolean> {
  if (!inDomainProject()) return false

  const foreign = foreignPackageManager()
  if (foreign) {
    if (!check) {
      log.dim(
        `  SDK dep check uses pnpm; this project uses ${foreign} — update it with ${foreign}.`,
      )
    }
    return false
  }

  const outdated = await findSdkOutdated()
  if (outdated.length === 0) {
    if (!check) log.dim('  @astrale-os SDK packages are up to date')
    return false
  }

  const plural = outdated.length === 1 ? '' : 's'
  log.info(`@astrale-os SDK package${plural} with a newer release (${outdated.length}):`)
  for (const o of outdated) log.dim(`  ${o.pkg}  ${o.current} → ${o.latest}`)

  if (check) return true // dry run — report only

  if (
    !assumeYes &&
    !(await confirmDefaultYes(
      `Update ${outdated.length} @astrale-os dep${plural} (pnpm update --latest)?`,
    ))
  ) {
    log.dim('  Skipped — your package.json is unchanged.')
    return true
  }
  log.step('pnpm update --latest --lockfile-only "@astrale-os/*"')
  if (await applySdkUpdate()) {
    log.success(`Updated ${outdated.length} @astrale-os dep${plural} in package.json + lockfile`)
    log.dim('  Run `pnpm install` to materialize the new versions.')
  } else {
    log.warn('  Update did not complete — run it yourself: pnpm update --latest "@astrale-os/*"')
  }
  return true
}

/**
 * Read-only staleness report for tooling — `astrale update --check --json`.
 * domain-studio polls this on load to drive its "update available" badge. It is
 * unified and NON-THROWING: the CLI axis catches the package-managed / no-metadata
 * case (reported as `managed`, never stale), and the SDK axis is already
 * best-effort. Skills are intentionally absent — they ride along with `astrale
 * update`, so a stale CLI or SDK is the only signal worth surfacing.
 */
export type StaleReport = {
  stale: boolean
  cli: { stale: boolean; managed: boolean; current?: string; latest?: string; channel?: string }
  sdk: { stale: boolean; inProject: boolean; outdated: SdkOutdated[] }
}

async function cliStale(opts: UpdateOpts): Promise<StaleReport['cli']> {
  const running = pkg.version
  const latest = await fetchNpmLatestVersion().catch(() => undefined)
  try {
    const r = await updateAstrale({
      check: true,
      channel: opts.channel,
      version: opts.version,
      currentVersion: running,
    })
    if (r.status === 'updated') {
      return { stale: false, managed: false, current: running, latest: latest ?? running }
    }
    return {
      stale: latest !== undefined ? latest !== running : r.status === 'available',
      managed: false,
      current: running,
      latest: latest ?? r.latestVersion,
      channel: latest !== undefined ? 'npm' : r.channel,
    }
  } catch {
    return {
      stale: latest !== undefined && latest !== running,
      managed: true,
      current: running,
      ...(latest === undefined ? {} : { latest, channel: 'npm' }),
    }
  }
}

async function fetchNpmLatestVersion(): Promise<string> {
  const response = await fetch('https://registry.npmjs.org/@astrale-os/cli/latest')
  if (!response.ok) throw new Error(`npm registry HTTP ${response.status}`)
  const body: unknown = await response.json()
  if (
    body === null ||
    typeof body !== 'object' ||
    typeof (body as { version?: unknown }).version !== 'string'
  ) {
    throw new Error('npm registry latest document is missing version')
  }
  return (body as { version: string }).version
}

async function sdkStale(): Promise<StaleReport['sdk']> {
  if (!inDomainProject() || foreignPackageManager()) {
    return { stale: false, inProject: inDomainProject(), outdated: [] }
  }
  const outdated = await findSdkOutdated()
  return { stale: outdated.length > 0, inProject: true, outdated }
}

export default {
  name: 'update',
  description: 'Check for and install Astrale CLI updates',
  options: [
    { flags: '--check', description: 'Only check whether an update is available' },
    {
      flags: '--channel <name>',
      description: 'Update from a release channel (alpha, beta, rc, canary, stable)',
    },
    { flags: '--version <version>', description: 'Update to an exact version tag' },
    { flags: '--no-skills', description: 'Skip refreshing the astrale agent skills' },
    { flags: '--no-deps', description: 'Skip checking @astrale-os SDK dependency versions' },
    {
      flags: '--yes',
      description: 'Non-interactive: apply CLI + skills + SDK deps without prompts',
    },
    ...RAW_OUTPUT_OPTIONS,
  ],
  afterHelpText: `
Behavior:
  Keeps three things current, in order. (1) The CLI binary: updates official
  script installs only — if Astrale was installed by another package manager this
  command refuses so that manager stays in charge; downloads are checksum-verified
  before the binary is replaced. (2) The agent skills: if the astrale skills (cli +
  domain) are already installed, refreshes them to the latest by delegating to
  "npx skills add astrale-os/cli -g" — the same installer "astrale setup" uses;
  fresh installs go through "astrale setup". (3) SDK deps: inside a pnpm domain
  project, proposes any @astrale-os/* dependency with a newer release and, on
  confirm, runs "pnpm update --latest --lockfile-only" (updates package.json AND
  the lockfile, honoring your registry + supply-chain age policy; run "pnpm
  install" to materialize).

  --check is a dry run (binary + SDK deps; exit 10 if anything is available) and
  never writes. With --json it emits a unified staleness report
  ({ stale, cli, sdk }) for tooling — non-throwing, skills omitted (they ride
  along with an update). --yes applies all three non-interactively (no prompts) and
  is resilient — a binary that can't self-update (package-managed) warns but never
  blocks the skills/deps steps; this is what domain-studio's "Update now" runs.
  --no-skills / --no-deps skip those steps in a real run.

Examples:
  $ astrale update
  $ astrale update --check
  $ astrale update --yes
  $ astrale update --no-skills
  $ astrale update --no-deps
  $ astrale update --channel canary
  $ astrale update --version 0.4.0-alpha.10
`,
  action: async (opts: UpdateOpts) => {
    try {
      // Tooling path: a machine-readable `--check` (e.g. domain-studio's update
      // badge polling `astrale update --check --json`) gets a unified,
      // non-throwing staleness report — CLI + SDK only — and exits.
      if (opts.check && isMachine(opts)) {
        const cli = await cliStale(opts)
        const sdk = await sdkStale()
        const report: StaleReport = { stale: cli.stale || sdk.stale, cli, sdk }
        output(report, opts)
        if (report.stale) process.exitCode = 10
        return
      }

      // Axis A — the CLI binary. Isolated so that under --yes (a non-interactive
      // full update, e.g. domain-studio's "Update now") a binary that can't
      // self-update — package-managed, no metadata — WARNS but does not abort the
      // skills/deps axes. Without --yes the error surfaces as before.
      let result: Awaited<ReturnType<typeof updateAstrale>> | null = null
      try {
        result = await updateAstrale({
          check: opts.check,
          channel: opts.channel,
          version: opts.version,
          currentVersion: pkg.version,
        })
      } catch (e) {
        if (!opts.yes) throw e
        log.warn(`CLI self-update skipped: ${e instanceof Error ? e.message : String(e)}`)
      }

      // Machine mode WITHOUT --yes (e.g. `astrale update --json`): emit the binary
      // result and stop — never silently refresh skills / edit deps for a pipe.
      if (result && isMachine(opts) && !opts.yes) {
        output(result, opts)
        return
      }

      // `available` only happens under --check (a real run already swapped the
      // binary and returns `updated`).
      let anyAvailable = false
      if (result?.status === 'available') {
        log.info(
          `Astrale update available: ${result.currentVersion} -> ${result.latestVersion} (${result.channel})`,
        )
        anyAvailable = true
      } else if (result?.status === 'up-to-date') {
        log.success(`Astrale is up to date: ${result.currentVersion}`)
      } else if (result?.status === 'updated') {
        log.success(`Updated astrale ${result.previousVersion} -> ${result.currentVersion}`)
        log.dim(`  channel: ${result.channel}`)
        log.dim(`  binary: ${result.bin}`)
      }

      // Axis B — agent skills. Keep an existing install current with the CLI.
      // Skip on --check (a dry run) and when the user opted out with --no-skills.
      if (!opts.check && opts.skills !== false) await refreshSkills()

      // Axis C — first-party @astrale-os/* deps in the current domain project.
      // Runs on --check too (reports availability); --yes applies without a prompt.
      if (opts.deps !== false && (await refreshSdkDeps(opts.check === true, opts.yes === true))) {
        anyAvailable = true
      }

      if (opts.check && anyAvailable) process.exitCode = 10
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
