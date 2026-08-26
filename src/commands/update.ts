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
import {
  checkAstraleSkills,
  type SkillApplyResult,
  type SkillCheckResult,
  syncAstraleSkills,
} from '../lib/skills'
import { DEFAULT_UPDATE_CHANNEL, packageManagedUpdateError, updateAstrale } from '../lib/update'

type UpdateOpts = RawOutputOpts & {
  check?: boolean
  channel?: string
  version?: string
  skills?: boolean
  deps?: boolean
  yes?: boolean
}

async function refreshSkills(): Promise<SkillApplyResult> {
  log.step('Ensuring Astrale agent skills are current and healthy')
  const result = await syncAstraleSkills()
  if (result.status === 'unchanged') log.success('Astrale skills already up to date')
  else if (result.status === 'installed') log.success('Astrale skills installed')
  else if (result.status === 'updated') log.success('Astrale skills updated')
  else if (result.status === 'repaired') log.success('Astrale skills repaired and updated')
  return result
}

function skillCheckStale(skills: SkillCheckResult): boolean {
  return skills.status === 'update-available' || skills.status === 'repair-needed'
}

function printSkillCheck(skills: SkillCheckResult): void {
  if (skills.status === 'current') log.success('Astrale skills are up to date')
  else if (skills.status === 'update-available') log.info('Astrale skills update available')
  else if (skills.status === 'repair-needed') log.warn('Astrale skills need repair')
  else if (skills.status === 'unavailable') {
    log.warn(`Could not verify Astrale skills${skills.error ? `: ${skills.error}` : ''}`)
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
 * unified and NON-THROWING: an explicit package-managed result uses npm release
 * identity, while script-install failures remain script failures in `error`
 * instead of being recategorized. The SDK axis is already best-effort. Skills
 * report meaningful health/freshness states. A current cohort also exposes its exact
 * source revision, skill trees, and entrypoints without leaking installer-local paths.
 */
export type StaleReport = {
  stale: boolean
  cli: {
    stale: boolean
    managed: boolean
    current?: string
    latest?: string
    channel?: string
    error?: string
  }
  skills: SkillCheckResult
  sdk: { stale: boolean; inProject: boolean; outdated: SdkOutdated[] }
}

type CliStaleDependencies = {
  update: typeof updateAstrale
  fetchPackageVersion: (opts: Pick<UpdateOpts, 'channel' | 'version'>) => Promise<string>
}

const CLI_STALE_DEPENDENCIES: CliStaleDependencies = {
  update: updateAstrale,
  fetchPackageVersion: fetchNpmTargetVersion,
}

export async function cliStale(
  opts: Pick<UpdateOpts, 'channel' | 'version'>,
  dependencies: CliStaleDependencies = CLI_STALE_DEPENDENCIES,
): Promise<StaleReport['cli']> {
  const running = pkg.version
  const target = { ...opts, channel: opts.channel ?? DEFAULT_UPDATE_CHANNEL }
  try {
    const r = await dependencies.update({
      check: true,
      channel: target.channel,
      version: target.version,
      currentVersion: running,
    })
    if (r.status === 'managed') {
      const latest = await dependencies.fetchPackageVersion(target).catch(() => undefined)
      return {
        stale: latest !== undefined && latest !== running,
        managed: true,
        current: running,
        ...(latest === undefined ? {} : { latest, channel: 'npm' }),
      }
    }
    if (r.status === 'updated') {
      return {
        stale: false,
        managed: false,
        current: r.currentVersion,
        latest: r.currentVersion,
        channel: r.channel,
      }
    }
    return {
      stale: r.status === 'available',
      managed: false,
      current: r.currentVersion,
      latest: r.latestVersion,
      channel: r.channel,
    }
  } catch (error) {
    return {
      stale: false,
      managed: false,
      current: running,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function fetchNpmTargetVersion(
  opts: Pick<UpdateOpts, 'channel' | 'version'>,
): Promise<string> {
  const channel = opts.channel ?? DEFAULT_UPDATE_CHANNEL
  const target = opts.version ?? (channel === 'stable' ? 'latest' : channel)
  const response = await fetch(`https://registry.npmjs.org/@astrale-os/cli/${target}`)
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
      default: DEFAULT_UPDATE_CHANNEL,
    },
    { flags: '--version <version>', description: 'Update to an exact version tag' },
    { flags: '--no-skills', description: 'Skip ensuring the Astrale agent skills' },
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
  before the binary is replaced. (2) The Astrale agent skills: installs every
  top-level skill published from one resolved astrale-os/cli main commit, updates healthy older
  installs, repairs inconsistent installs, and verifies the result before
  reporting success. (3) SDK deps: inside a pnpm domain
  project, proposes any @astrale-os/* dependency with a newer release and, on
  confirm, runs "pnpm update --latest --lockfile-only" (updates package.json AND
  the lockfile, honoring your registry + supply-chain age policy; run "pnpm
  install" to materialize).

  The default release channel is beta; --channel overrides it for one run.
  --check is a dry run (binary + skills + SDK deps; exit 10 if anything is available) and
  never writes. With --json it emits a unified staleness report
  ({ stale, cli, skills, sdk }) for tooling. --yes applies all three non-interactively and
  is resilient — a binary that can't self-update (package-managed) warns but never
  blocks the skills/deps steps; a skill failure fails the command rather than
  claiming a partial success. --no-skills / --no-deps explicitly skip those axes.

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
      // non-throwing staleness report and exits.
      if (opts.check && isMachine(opts)) {
        const cli = await cliStale(opts)
        const skills: SkillCheckResult =
          opts.skills === false ? { status: 'skipped' } : await checkAstraleSkills()
        const sdk = await sdkStale()
        const report: StaleReport = {
          stale: cli.stale || skillCheckStale(skills) || sdk.stale,
          cli,
          skills,
          sdk,
        }
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
      } else if (result?.status === 'managed') {
        const error = packageManagedUpdateError(result.executable)
        if (!opts.yes) throw error
        log.warn(`CLI self-update skipped: ${error.message}`)
      }

      // Axis B — agent skills. A successful real update guarantees a verified
      // latest cohort; --check remains read-only and reports its status.
      if (opts.skills !== false) {
        if (opts.check) {
          const skills = await checkAstraleSkills()
          printSkillCheck(skills)
          if (skillCheckStale(skills)) anyAvailable = true
        } else {
          await refreshSkills()
        }
      } else if (!opts.check) {
        log.dim('  Astrale skills skipped (--no-skills)')
      }

      // Axis C — first-party @astrale-os/* deps in the current domain project.
      // Runs on --check too (reports availability); --yes applies without a prompt.
      if (opts.deps !== false && (await refreshSdkDeps(opts.check === true, opts.yes === true))) {
        anyAvailable = true
      }

      if (opts.check && anyAvailable) process.exitCode = 10
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition
