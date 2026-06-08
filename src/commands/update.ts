import type { CommandDefinition } from '../command'

import pkg from '../../package.json' with { type: 'json' }
import { fatal, log } from '../lib/log'
import { isRawOutput, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../lib/output'
import { updateAstrale } from '../lib/update'

type UpdateOpts = RawOutputOpts & {
  check?: boolean
  channel?: string
  version?: string
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
    ...RAW_OUTPUT_OPTIONS,
  ],
  afterHelpText: `
Behavior:
  Updates official script installs only. If Astrale was installed by another
  package manager, this command refuses so that package manager stays in charge.
  Downloads are checksum-verified before the current binary is replaced.

Examples:
  $ astrale update
  $ astrale update --check
  $ astrale update --channel canary
  $ astrale update --version 0.4.0-alpha.7
`,
  action: async (opts: UpdateOpts) => {
    try {
      const result = await updateAstrale({
        check: opts.check,
        channel: opts.channel,
        version: opts.version,
        currentVersion: pkg.version,
      })

      if (isRawOutput(opts)) {
        output(result, opts)
        if (opts.check && result.status === 'available') process.exitCode = 10
        return
      }

      if (result.status === 'up-to-date') {
        log.success(`Astrale is up to date: ${result.currentVersion}`)
        return
      }
      if (result.status === 'available') {
        log.info(
          `Astrale update available: ${result.currentVersion} -> ${result.latestVersion} (${result.channel})`,
        )
        process.exitCode = 10
        return
      }
      log.success(`Updated astrale ${result.previousVersion} -> ${result.currentVersion}`)
      log.dim(`  channel: ${result.channel}`)
      log.dim(`  binary: ${result.bin}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
