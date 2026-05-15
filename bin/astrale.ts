#!/usr/bin/env bun
import { Command, Option } from 'commander'

import type { CommandDefinition } from '../src/command'

import { KERNEL_PASSTHROUGH_OPTIONS } from '../src/kernel/options'
import { RAW_OUTPUT_OPTIONS } from '../src/lib/output'
import { registerCommand, registerGroup } from '../src/registry'

const program = new Command()

program
  .name('astrale')
  .description('Astrale system CLI — manage your local Astrale installation')
  .version('0.1.0')
  .showSuggestionAfterError(true)
  .addOption(new Option('--ci', 'Machine mode: no prompts, structured errors on stderr'))
  .addOption(new Option('--no-prompt', 'Disable interactive prompts'))
  .addOption(
    new Option('--offline-ok', 'Tolerate offline state for commands that can operate locally'),
  )
  .addOption(
    new Option('--log-level <level>', 'Log level').choices(['debug', 'info', 'warn', 'error']),
  )
  .addOption(new Option('--log-format <format>', 'Log output format').choices(['text', 'json']))
  .action(() => {
    program.help()
  })

// Options shared by every kernel-touching command (call / token / get / ls /
// describe / query + `instance install`). Merged onto the command's own
// options at the registration site so the list stays single-sourced — the
// command-definition files only carry their command-specific options.
const kernelOptions = [
  {
    flags: '--format <type>',
    description: 'Output format (default: yaml in TTY, json when piped)',
    choices: ['yaml', 'json'],
  },
  ...RAW_OUTPUT_OPTIONS,
  ...KERNEL_PASSTHROUGH_OPTIONS,
]

const withKernelOptions = (def: CommandDefinition): CommandDefinition => ({
  ...def,
  options: [...(def.options ?? []), ...kernelOptions],
})

// ── Lifecycle ──────────────────────────────────────────────────
registerCommand(program, (await import('../src/commands/init')).default)
registerCommand(program, (await import('../src/commands/start')).default)
registerCommand(program, (await import('../src/commands/stop')).default)
registerCommand(program, (await import('../src/commands/restart')).default)
registerCommand(program, (await import('../src/commands/status')).default)
registerCommand(program, (await import('../src/commands/reset')).default)
registerCommand(program, (await import('../src/commands/use')).default)

// Verbatim alias of `identity whoami` — defer to the command-definition
// module so options stay in sync.
const whoamiMod = await import('../src/commands/identity/whoami')
registerCommand(program, {
  name: 'whoami',
  description: 'Show the current default identity (alias for identity whoami)',
  options: whoamiMod.default.options,
  action: whoamiMod.default.action,
})

// ── Graph / kernel ─────────────────────────────────────────────
registerCommand(program, withKernelOptions((await import('../src/commands/call')).default))
registerCommand(program, withKernelOptions((await import('../src/commands/token')).default))
registerCommand(program, withKernelOptions((await import('../src/commands/get')).default))
registerCommand(program, withKernelOptions((await import('../src/commands/ls')).default))
registerCommand(program, withKernelOptions((await import('../src/commands/describe')).default))
registerCommand(program, withKernelOptions((await import('../src/commands/query')).default))

registerGroup(program, {
  name: 'instance',
  description: 'Manage kernel instances (§4, §5, §6, §7)',
  commands: [
    (await import('../src/commands/instance/list')).default,
    (await import('../src/commands/instance/bookmark')).default,
    (await import('../src/commands/instance/forget')).default,
    (await import('../src/commands/instance/create')).default,
    (await import('../src/commands/instance/add')).default,
    (await import('../src/commands/instance/delete')).default,
    (await import('../src/commands/instance/status')).default,
    (await import('../src/commands/instance/active')).default,
    (await import('../src/commands/instance/use')).default,
    withKernelOptions((await import('../src/commands/instance/install')).default),
  ],
})

registerGroup(program, {
  name: 'identity',
  description: 'Manage CLI identities (§2)',
  commands: [
    (await import('../src/commands/identity/create')).default,
    (await import('../src/commands/identity/register')).default,
    (await import('../src/commands/identity/list')).default,
    (await import('../src/commands/identity/use')).default,
    (await import('../src/commands/identity/whoami')).default,
    (await import('../src/commands/identity/delete')).default,
    (await import('../src/commands/identity/sync')).default,
    (await import('../src/commands/identity/unsync')).default,
    (await import('../src/commands/identity/export')).default,
    (await import('../src/commands/identity/import')).default,
  ],
})

registerGroup(program, {
  name: 'auth',
  description: 'Astrale cloud authentication (stubbed v1, §15)',
  commands: [
    (await import('../src/commands/auth/login')).default,
    (await import('../src/commands/auth/logout')).default,
    (await import('../src/commands/auth/status')).default,
  ],
})

registerGroup(program, {
  name: 'tunnel',
  description: 'Machine-level tunnels (§12, cloudflared adapter)',
  commands: [
    (await import('../src/commands/tunnel/setup')).default,
    (await import('../src/commands/tunnel/adopt')).default,
    (await import('../src/commands/tunnel/start')).default,
    (await import('../src/commands/tunnel/status')).default,
    (await import('../src/commands/tunnel/list')).default,
    (await import('../src/commands/tunnel/stop')).default,
  ],
})

registerGroup(program, {
  name: 'graph',
  description: 'Manage FalkorDB graphs',
  commands: [
    (await import('../src/commands/graph/list')).default,
    (await import('../src/commands/graph/prune')).default,
    (await import('../src/commands/graph/rm')).default,
    (await import('../src/commands/graph/df')).default,
  ],
})

registerGroup(program, {
  name: 'server',
  description: 'Manager server lifecycle (docker image + container logs)',
  commands: [
    (await import('../src/commands/server/build')).default,
    (await import('../src/commands/server/logs')).default,
  ],
})

registerGroup(program, {
  name: 'domain',
  description: 'Manage kernel domains (§9)',
  commands: [
    (await import('../src/commands/domain/init')).default,
    (await import('../src/commands/domain/build')).default,
    (await import('../src/commands/domain/deploy')).default,
    (await import('../src/commands/domain/check')).default,
    (await import('../src/commands/domain/logs')).default,
    (await import('../src/commands/domain/instance-prepare')).default,
  ],
  subgroups: [
    {
      name: 'dev',
      description:
        'Local dev infrastructure lifecycle (replaces `pnpm infra:prepare`/`infra:down`)',
      commands: [
        (await import('../src/commands/domain/dev/up')).default,
        (await import('../src/commands/domain/dev/down')).default,
        (await import('../src/commands/domain/dev/status')).default,
      ],
    },
  ],
})

program.addHelpText(
  'after',
  `
Command groups:
  Lifecycle     init, start, stop, restart, status, reset
  Graph         ls, get, call, query, describe, logs, token
  Management    instance, identity, auth, tunnel
  Storage       graph list, graph prune, graph rm, graph df
  Server        server build, server logs
  Domains       domain init, domain build, domain deploy, domain check,
                domain logs, domain instance-prepare, domain dev (up|down|status)

Path syntax:
  /domain/class.Name/method    Navigate to a Method node (static operation)
  /domain/class.Name::method   Call a method on a node instance
  @nodeId                      Reference a node by its ID

Examples:
  $ astrale ls /
  $ astrale call /manager.astrale.ai/class.KernelInstance/list
  $ astrale instance bookmark staging --url https://kernel.example.com
  $ astrale instance create my-app --local --install ./dist/spec.json
  $ astrale instance status staging
  $ astrale token --audience dist.astrale.ai --ttl 3600
  $ astrale logs --topic 'op:*:failed' -n 10
  $ astrale query 'MATCH (n) RETURN n LIMIT 5'
`,
)

program.parse()
