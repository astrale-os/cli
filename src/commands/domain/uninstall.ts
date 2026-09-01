import { Path } from '@astrale-os/sdk/graph/path'
import { K } from '@astrale-os/sdk/schema'
import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'

import { createPathCall, runKernelCommand } from '../../connection'
import { AstraleError } from '../../errors'
import { canPrompt } from '../../lib/interactive'
import { fatal, log } from '../../lib/log'
import { output } from '../../lib/output'
import { dangerPanel } from '../../lib/panel'
import { confirmWithInput } from '../../lib/prompt'

type UninstallOpts = KernelCommandOpts & {
  readonly yes?: boolean
  readonly ci?: boolean
  readonly noPrompt?: boolean
}

type UninstallResult = {
  readonly operation: string
  readonly transition: {
    readonly intent: {
      readonly origin: string
    }
  }
}

/** Public Kernel uninstall syscall input for one installed Domain origin. */
export function uninstallCallInput(
  origin: string,
  operation: string = crypto.randomUUID(),
): Readonly<{ operation: string; origin: string }> {
  return Object.freeze({ operation, origin })
}

export default {
  name: 'uninstall',
  description: 'Uninstall a domain from an instance through the public Kernel syscall',
  afterHelpText: `
Behavior:
  Removes one installed Domain origin from the target instance. The Kernel
  refuses the operation while another installed Domain depends on it or while
  business data still uses its schema. Uninstall never deletes business data.
  Type the exact origin to confirm, or pass --yes in automation.

  Use this before reinstalling only when an immutable Domain property (such as
  its issuer) intentionally changed. Ordinary compatible upgrades should use
  domain install directly and preserve the existing Domain identity.

Examples:
  $ astrale domain uninstall grc.example -i staging
  $ astrale domain uninstall grc.example -i staging --yes --json
`,
  arguments: [
    {
      name: 'origin',
      description: 'Installed Domain origin to remove',
      required: true,
    },
  ],
  options: [
    {
      flags: '--yes',
      description: 'Confirm Domain uninstall without prompting',
    },
  ],
  action: async (origin: string, opts: UninstallOpts) => {
    try {
      await confirmUninstall(origin, opts)
    } catch (error) {
      fatal(error, opts)
    }

    await runKernelCommand<UninstallResult>({
      opts,
      label: `Uninstalling domain ${origin}`,
      fn: async ({ session }) =>
        (await session.call(
          createPathCall(Path.project(K.functions.uninstall.ref).raw, uninstallCallInput(origin)),
        )) as UninstallResult,
      format: (result, formatOpts, machine) => {
        if (machine) {
          output(result, formatOpts)
          return
        }
        log.success(`Domain uninstalled: ${result.transition.intent.origin}`)
        log.dim(`  operation: ${result.operation}`)
      },
    })
  },
} satisfies CommandDefinition

async function confirmUninstall(origin: string, opts: UninstallOpts): Promise<void> {
  if (opts.yes) return

  if (!canPrompt(opts)) {
    throw new AstraleError(
      'CONFIRMATION_REQUIRED',
      `Uninstalling Domain "${origin}" requires explicit confirmation.`,
      `Re-run with --yes: astrale domain uninstall ${origin} --yes`,
    )
  }

  const warning = dangerPanel('DOMAIN UNINSTALL', [
    `origin     ${chalk.bold(origin)}`,
    '',
    'This removes the installed Domain from the target instance.',
    'This command never deletes business data.',
    'The Kernel refuses removal while dependents or business data remain.',
  ])
  if (!(await confirmWithInput(warning, origin))) {
    throw new AstraleError('UNINSTALL_CANCELLED', `Domain uninstall cancelled for "${origin}".`)
  }
}
