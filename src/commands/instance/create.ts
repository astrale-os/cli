import type { CommandDefinition } from '../../program/index'

import { formatKernelError } from '../../connection/errors'
import { AstraleError } from '../../errors'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { isMachine, output } from '../../lib/output'
import { promptText } from '../../lib/prompt'
import { provisionInstance, type ProvisionOpts } from '../../lib/provision-instance'
import { validateSlug } from '../../lib/validation'

/** inquirer `validate` for a slug: true when valid, else the human message. */
function slugError(value: string): true | string {
  try {
    validateSlug(value)
    return true
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid slug'
  }
}

export default {
  name: 'create',
  description: 'Provision an instance through the Admin control plane',
  afterHelpText: `
Behavior:
  Requests a new Instance from the configured Admin Domain. The caller must be
  logged in with WorkOS. Admin owns infrastructure placement. The new instance
  becomes the active instance.

  Run with no slug in a terminal and it prompts for one (validated live). With
  no TTY — or --ci / --no-prompt — the slug argument is required up front, so
  piped / CI / agent runs fail fast instead of waiting on input.

Examples:
  $ astrale auth login
  $ astrale instance create demo
`,
  arguments: [{ name: 'id', description: 'Instance slug', required: false }],
  options: [...ADMIN_TARGET_OPTIONS],
  action: async (id: string | undefined, opts: ProvisionOpts) => {
    try {
      // Prompt for the slug when omitted, with live validation. A terminal the
      // CLI may not question — piped, --ci / --no-prompt, CI — makes promptText
      // yield undefined, so the slug argument becomes required and the run fails
      // fast instead of hanging.
      if (!id) id = await promptText('Instance slug', { ...opts, validate: slugError })
      if (!id) {
        // AstraleError, not Error: `fatal` keeps a coded error's message and
        // drops a plain one behind "unexpected internal failure" — and this is
        // exactly what a piped / --no-prompt / agent run lands on.
        throw new AstraleError(
          'MISSING_ARG',
          '`instance create` needs a slug when the terminal cannot be prompted.',
          'astrale instance create demo',
        )
      }

      const { created } = await provisionInstance(id, opts)

      if (isMachine(opts)) {
        output(created, opts)
        return
      }
    } catch (e) {
      await formatKernelError(e, isMachine(opts), undefined, opts.debug)
      process.exit(1)
    }
  },
} satisfies CommandDefinition
