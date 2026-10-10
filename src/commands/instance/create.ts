import type { CommandDefinition } from '../../program/index'

import { formatKernelError } from '../../connection/errors'
import { AstraleError } from '../../errors'
import { ADMIN_TARGET_OPTIONS, FLEET_OPTION } from '../../lib/admin-target'
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
  description: 'Create an instance through Admin and verify owner access',
  afterHelpText: `
Behavior:
  Requests a new Instance from the configured Admin Domain. The caller must be
  logged in with WorkOS. Admin owns infrastructure placement. The new instance
  is bookmarked after its owner access is finalized and verified. An existing
  active target is preserved; with no active target, the new instance becomes active.
  A bookmark name already pointing elsewhere is preserved and reported separately
  from the successful creation, with a command to bookmark under an unused name.
  To switch afterwards, run astrale instance use <bookmark-name>. If finalization
  is interrupted, rerun the same create command with the same Admin target options
  (--admin, --admin-url, --domain-issuer), Fleet (--fleet), operation (--operation)
  and creator's WorkOS identity (--as).
  Admin verifies and resumes its retained creation receipt; the Instance and
  reserved owner are not recreated.
  An unfinished journey returns a nonzero exit status with the retained receipt.
  A refused creation fails its operation, for example INSTANCE_CAPACITY_UNAVAILABLE
  when the Fleet has no ready consumer Host: the command stops at once and names
  the operation and the cause. Replaying that --operation returns the same
  refusal; once the cause is fixed, rerun without --operation.

  Run with no slug in a terminal and it prompts for one (validated live). With
  no TTY — or --ci / --no-prompt — the slug argument is required up front, so
  piped / CI / agent runs fail fast instead of waiting on input.

Examples:
  $ astrale auth login
  $ astrale instance create demo
`,
  arguments: [{ name: 'id', description: 'Instance slug', required: false }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    FLEET_OPTION,
    {
      flags: '--operation <id>',
      description: 'Reuse an exact create operation id for explicit retry and recovery',
    },
  ],
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

      const { created, access, bookmark } = await provisionInstance(id, opts)

      if (
        created.state !== 'ready' ||
        access?.status !== 'completed' ||
        bookmark?.status === 'pending'
      ) {
        process.exitCode = 1
      }

      if (isMachine(opts)) {
        output(
          {
            ...created,
            ...(access === undefined ? {} : { access }),
            ...(bookmark === undefined ? {} : { bookmark }),
          },
          opts,
        )
        return
      }
    } catch (e) {
      await formatKernelError(e, isMachine(opts), undefined, opts.debug)
      process.exit(1)
    }
  },
} satisfies CommandDefinition
