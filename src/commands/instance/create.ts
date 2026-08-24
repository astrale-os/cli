import type { CommandDefinition } from '../../program/index'

import { formatKernelError } from '../../connection/errors'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { isMachine, output } from '../../lib/output'
import { promptText } from '../../lib/prompt'
import { provisionInstance, type ProvisionOpts } from '../../lib/provision-instance'
import { validateSlug } from '../../lib/validation'

// Re-exported for tests + `astrale setup`, which share the provisioning saga.
export { assertInstanceCreateIdentity } from '../../lib/provision-instance'

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
      // Interactive (TTY only): prompt for the slug when omitted, with live
      // validation. No TTY / --ci / --no-prompt / CI → the slug arg is required
      // (fail fast, never hang a piped / agent / LLM run).
      const interactive = !!process.stdin.isTTY && !(opts.ci || opts.noPrompt || process.env.CI)
      if (!id && interactive) id = await promptText('Instance slug', { validate: slugError })
      if (!id) {
        throw new Error('`instance create` needs a slug, e.g. `astrale instance create demo`.')
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
