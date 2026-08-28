import type { CommandDefinition } from '../program/index'

import pkg from '../../package.json' with { type: 'json' }
import { AstraleError } from '../errors'
import { fatal, log } from '../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../lib/output'
import { run, runInherit } from '../lib/proc'
import { confirmDefaultYes } from '../lib/prompt'
import {
  applySdkUpdate,
  findSdkOutdated,
  foreignPackageManager,
  inDomainProject,
  type SdkOutdated,
} from '../lib/sdk-deps'
import { checkAstraleSkills, SKILL_CONFIGURE_COMMAND, type SkillCheckResult } from '../lib/skills'
import { DEFAULT_UPDATE_CHANNEL, packageManagedUpdateError, updateAstrale } from '../lib/update'
import { configureAstraleSkills, renderSkillConfigureOutcome } from './skills/configure'

type UpdateOpts = RawOutputOpts & {
  check?: boolean
  channel?: string
  version?: string
  skills?: boolean
  deps?: boolean
  yes?: boolean
}

async function refreshSkills(interactive: boolean, humanOutput: boolean): Promise<void> {
  if (humanOutput) log.step('Ensuring Astrale agent skills are current and healthy')
  const outcome = await configureAstraleSkills({ source: 'update', interactive })
  if (humanOutput) renderSkillConfigureOutcome(outcome)
}

function skillInstallPromptAllowed(opts: UpdateOpts): boolean {
  return (
    opts.yes !== true &&
    !isMachine(opts) &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    !process.env.CI &&
    !process.env.CONTINUOUS_INTEGRATION &&
    !process.argv.includes('--no-prompt')
  )
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
 * unified and NON-THROWING: source/development builds report themselves as
 * externally managed, while standalone failures remain explicit in `error`.
 * The SDK axis is already best-effort. A current skill cohort exposes its
 * embedded revision, trees, and entrypoints without installer-local paths.
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
}

const CLI_STALE_DEPENDENCIES: CliStaleDependencies = {
  update: updateAstrale,
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
      return {
        stale: false,
        managed: true,
        current: running,
      }
    }
    if (r.status === 'updated' || r.status === 'repaired') {
      return {
        stale: false,
        managed: false,
        current: r.currentVersion,
        latest: r.currentVersion,
        channel: r.channel,
      }
    }
    return {
      stale: r.status === 'available' || r.status === 'repair-available',
      managed: false,
      current: r.currentVersion,
      latest: r.status === 'repair-available' ? r.currentVersion : r.latestVersion,
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

async function refreshSkillsWithUpdatedBinary(bin: string, interactive: boolean): Promise<void> {
  if (interactive) {
    const code = await runInherit(bin, ['skills', 'configure', '--source', 'update'])
    if (code === 0) return
    throw new AstraleError(
      'SKILL_UPDATE_FAILED',
      'The CLI was updated, but its embedded skills could not be applied.',
      `Retry with \`${bin} skills configure\`.`,
    )
  }

  const result = await run(bin, [
    '--no-prompt',
    'skills',
    'configure',
    '--source',
    'update',
    '--json',
  ])
  if (result.code === 0) {
    if (!isMachine()) {
      try {
        const outcome = JSON.parse(result.stdout) as { status?: string }
        if (outcome.status === 'not-interactive') {
          log.dim(`  Skills are not installed. Run: ${SKILL_CONFIGURE_COMMAND}`)
        } else if (outcome.status === 'unchanged') {
          log.success('Astrale skills already up to date')
        } else if (['installed', 'updated', 'repaired'].includes(outcome.status ?? '')) {
          log.success('Astrale skills updated')
        }
      } catch {
        // The child succeeded; its optional machine output is only for nicer human feedback.
      }
    }
    return
  }
  throw new AstraleError(
    'SKILL_UPDATE_FAILED',
    'The CLI was updated, but its embedded skills could not be applied.',
    `Retry with \`${bin} skills configure\`.${result.stderr.trim() ? ` ${result.stderr.trim()}` : ''}`,
  )
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
      description: 'Non-interactive: apply updates without opting into a first skill install',
    },
    ...RAW_OUTPUT_OPTIONS,
  ],
  afterHelpText: `
Behavior:
  Keeps three things current, in order. (1) The CLI toolchain: updates official
  standalone installs; the CLI, pinned private provider, license, and metadata
  are checksum-verified and replaced as one recoverable cohort; externally managed
  processes are directed to the standalone installer and never overwritten. (2) The Astrale
  agent skills: aligns an existing cohort with the exact CLI release, repairs
  inconsistent installs, and verifies the result. If skills are absent, an
  interactive update offers to install them. (3) SDK deps: inside a pnpm domain
  project, proposes any @astrale-os/* dependency with a newer release and, on
  confirm, runs "pnpm update --latest --lockfile-only" (updates package.json AND
  the lockfile, honoring your registry + supply-chain age policy; run "pnpm
  install" to materialize).

  The default release channel is beta; --channel overrides it for one run.
  --check is a dry run (binary + skills + SDK deps; exit 10 if anything is available) and
  never writes. With --json it emits a unified staleness report
  ({ stale, cli, skills, sdk }) for tooling. --yes applies existing updates
  non-interactively but does not opt into a first skill installation. A skill
  failure fails the command rather than claiming a partial success. --no-skills
  / --no-deps explicitly skip those axes.

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

      // Axis A — the standalone CLI binary.
      const result = await updateAstrale({
        check: opts.check,
        channel: opts.channel,
        version: opts.version,
        currentVersion: pkg.version,
      })

      // Machine mode WITHOUT --yes (e.g. `astrale update --json`): emit the binary
      // result and stop — never silently refresh skills / edit deps for a pipe.
      if (isMachine(opts) && !opts.yes) {
        output(result, opts)
        return
      }

      // `available` only happens under --check (a real run already swapped the
      // binary and returns `updated`).
      let anyAvailable = false
      if (result.status === 'available') {
        log.info(
          `Astrale update available: ${result.currentVersion} -> ${result.latestVersion} (${result.channel})`,
        )
        anyAvailable = true
      } else if (result.status === 'up-to-date') {
        log.success(`Astrale is up to date: ${result.currentVersion}`)
      } else if (result.status === 'updated') {
        log.success(`Updated astrale ${result.previousVersion} -> ${result.currentVersion}`)
        log.dim(`  channel: ${result.channel}`)
        log.dim(`  binary: ${result.bin}`)
      } else if (result.status === 'repaired') {
        log.success(`Repaired Astrale toolchain ${result.currentVersion}`)
        log.dim(`  binary: ${result.bin}`)
      } else if (result.status === 'repair-available') {
        log.info(`Astrale toolchain repair available: ${result.currentVersion}`)
        anyAvailable = true
      } else if (result.status === 'managed') {
        const error = packageManagedUpdateError(result.executable)
        throw error
      }

      // Axis B — agent skills. A successful real update guarantees a verified
      // latest cohort by running the newly installed binary, never the old
      // process's embedded assets. --check remains read-only.
      if (opts.skills !== false) {
        const interactiveSkills = skillInstallPromptAllowed(opts)
        const humanSkills = !isMachine(opts)
        if (opts.check) {
          const skills = await checkAstraleSkills()
          printSkillCheck(skills)
          if (skillCheckStale(skills)) anyAvailable = true
        } else if (result.status === 'updated') {
          if (humanSkills) log.step('Applying skills embedded in the updated CLI')
          await refreshSkillsWithUpdatedBinary(result.bin, interactiveSkills)
        } else {
          await refreshSkills(interactiveSkills, humanSkills)
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
