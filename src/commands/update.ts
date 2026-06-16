import type { CommandDefinition } from '../command'

import pkg from '../../package.json' with { type: 'json' }
import { fatal, log } from '../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../lib/output'
import { ASTRALE_CLI_SKILL, detectSkill, installSkills, SKILL_INSTALL_HINT } from '../lib/skills'
import { updateAstrale } from '../lib/update'

type UpdateOpts = RawOutputOpts & {
  check?: boolean
  channel?: string
  version?: string
  skills?: boolean
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
    ...RAW_OUTPUT_OPTIONS,
  ],
  afterHelpText: `
Behavior:
  Updates official script installs only. If Astrale was installed by another
  package manager, this command refuses so that package manager stays in charge.
  Downloads are checksum-verified before the current binary is replaced.

  After the binary step, if the astrale agent skills (cli + domain) are already
  installed, it refreshes them to the latest published version by delegating to
  "npx skills add astrale-os/cli" — the same installer "astrale setup" uses — so
  the skills track the CLI. Fresh installs go through "astrale setup". Pass
  --no-skills to skip, or --check (a dry run) which never touches skills.
  Skipped in --json mode.

Examples:
  $ astrale update
  $ astrale update --check
  $ astrale update --no-skills
  $ astrale update --channel canary
  $ astrale update --version 0.4.0-alpha.10
`,
  action: async (opts: UpdateOpts) => {
    try {
      const result = await updateAstrale({
        check: opts.check,
        channel: opts.channel,
        version: opts.version,
        currentVersion: pkg.version,
      })

      if (isMachine(opts)) {
        output(result, opts)
        if (opts.check && result.status === 'available') process.exitCode = 10
        return
      }

      if (result.status === 'available') {
        log.info(
          `Astrale update available: ${result.currentVersion} -> ${result.latestVersion} (${result.channel})`,
        )
        process.exitCode = 10
        return
      }

      if (result.status === 'up-to-date') {
        log.success(`Astrale is up to date: ${result.currentVersion}`)
      } else {
        log.success(`Updated astrale ${result.previousVersion} -> ${result.currentVersion}`)
        log.dim(`  channel: ${result.channel}`)
        log.dim(`  binary: ${result.bin}`)
      }

      // Keep the skills current with the CLI. Skip on --check (a dry run) and
      // when the user opted out with --no-skills.
      if (!opts.check && opts.skills !== false) await refreshSkills()
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
