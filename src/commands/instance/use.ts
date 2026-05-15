import type { CommandDefinition } from '../../command'

import { type UseOpts, useCommand } from '../use'

export default {
  name: 'use',
  description: 'Set the active kernel instance (no args: show current, §9.1)',
  afterHelpText: `
Behavior:
  The active instance lives in ~/.astrale/instances.json (a
  process-global file). Concurrent instance:prepare or parallel test
  runs can rewrite it under you — in scripted/parallel flows pass
  -i <instance> on every command instead of relying on \`use\`.

Examples:
  $ astrale instance use staging
  $ astrale instance use staging --adopt-default
`,
  arguments: [{ name: 'name', description: 'Registered instance name', required: false }],
  options: [
    {
      flags: '--adopt-default',
      description: 'Adopt instance default identity without prompt (§7.1)',
    },
    { flags: '--skip-jwks-check', description: 'Skip the /meta ↔ JWKS match check (§7)' },
  ],
  action: async (name: string | undefined, opts: UseOpts) => {
    await useCommand(name, opts)
  },
} satisfies CommandDefinition
