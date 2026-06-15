import type { CommandDefinition } from '../command'

import { ADMIN_TARGET_OPTIONS } from '../lib/admin-target'
import { fatal } from '../lib/log'
import { RAW_OUTPUT_OPTIONS } from '../lib/output'
import { runSetup, type SetupOpts } from '../setup/engine'

export default {
  name: 'setup',
  description: 'Guided first run: sign in, pick an instance, and equip your workspace',
  arguments: [
    {
      name: 'slug',
      description: 'Instance slug to provision when none is active',
      required: false,
    },
  ],
  options: [
    { flags: '--plan', description: 'Print what setup would do (read-only) and exit' },
    ...ADMIN_TARGET_OPTIONS,
    ...RAW_OUTPUT_OPTIONS,
  ],
  afterHelpText: `
What it does:
  Walks you from zero to a working instance, then offers to equip your agent:
    1. Connect    sign in (WorkOS), confirm the admin control plane, pick or
                  provision an instance — ending on your live instance URL.
    2. Equip      the astrale agent skills (cli + domain), agent-browser, and a
                  first domain (a pre-checked multi-select — toggle off any).

  Idempotent: re-run it anytime; satisfied steps are skipped. Bare \`astrale\`
  in a terminal launches this when you have no active instance yet.

Agents / CI:
  Piped, --ci, or --plan → read-only. \`astrale setup --plan --json\` prints each
  step's state and the exact command to fix it; run those granular commands
  (auth login / instance create / …) rather than the interactive wizard.

Examples:
  $ astrale setup                 # the guided flow
  $ astrale setup my-app          # pre-fill the instance slug
  $ astrale setup --plan          # what's left to do (no changes)
  $ astrale setup --plan --json   # machine-readable plan for an agent
`,
  action: async (slug: string | undefined, opts: SetupOpts) => {
    try {
      await runSetup(opts, slug)
    } catch (e) {
      // fatal() exits 130 quietly on Ctrl-C (ExitPromptError); each step's
      // writes are atomic + idempotent, so nothing half-applied matters.
      fatal(e)
    }
  },
} satisfies CommandDefinition
