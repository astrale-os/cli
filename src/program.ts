import { Command, Option } from 'commander'

import type { CommandDefinition } from './command'

import pkg from '../package.json' with { type: 'json' }
import { KERNEL_PASSTHROUGH_OPTIONS } from './kernel/options'
import { RAW_OUTPUT_OPTIONS } from './lib/output'
import { registerCommand, registerGroup } from './registry'

/**
 * Build the fully-wired Commander program (every command + group registered)
 * WITHOUT parsing argv. `bin/astrale.ts` is a thin shim that calls this and
 * `.parse()`; tests import it to walk the command tree (the `--help` surface
 * is asserted to be the source of truth it claims to be — see
 * `commands/__tests__/help-contract.test.ts`).
 */
export async function buildProgram(): Promise<Command> {
  const program = new Command()

  program
    .name('astrale')
    .description('Astrale system CLI — manage your local Astrale installation')
    // Single source of truth = package.json (bumped by release-please together
    // with .release-please-manifest.json). Never hand-write a version literal.
    .version(pkg.version)
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
  registerCommand(program, (await import('./commands/init')).default)
  registerCommand(program, (await import('./commands/start')).default)
  registerCommand(program, (await import('./commands/stop')).default)
  registerCommand(program, (await import('./commands/restart')).default)
  registerCommand(program, (await import('./commands/status')).default)
  registerCommand(program, (await import('./commands/reset')).default)
  // Manager-only, like `status` — deliberately NOT withKernelOptions: bootstrap
  // must hard-target the manager, so -i/--instance/--url are omitted (a foot-gun
  // here — they would let it silently mis-target a child).
  registerCommand(program, (await import('./commands/bootstrap')).default)

  // Verbatim alias of `identity whoami` — defer to the command-definition
  // module so options stay in sync.
  const whoamiMod = await import('./commands/identity/whoami')
  registerCommand(program, {
    name: 'whoami',
    description: 'Show the current default identity (alias for identity whoami)',
    options: whoamiMod.default.options,
    action: whoamiMod.default.action,
  })

  // ── Graph / kernel ─────────────────────────────────────────────
  registerCommand(program, withKernelOptions((await import('./commands/call')).default))
  registerCommand(program, withKernelOptions((await import('./commands/token')).default))
  registerCommand(program, withKernelOptions((await import('./commands/get')).default))
  registerCommand(program, withKernelOptions((await import('./commands/ls')).default))
  registerCommand(program, withKernelOptions((await import('./commands/describe')).default))
  registerCommand(program, withKernelOptions((await import('./commands/query')).default))
  // `logs` reads ~/.astrale/logs/*.ndjson directly (not the kernel client) and
  // carries its own --instance — deliberately NOT withKernelOptions.
  registerCommand(program, (await import('./commands/logs')).default)

  registerGroup(program, {
    name: 'instance',
    description: 'Manage kernel instances (local children + remote bookmarks)',
    commands: [
      (await import('./commands/instance/list')).default,
      (await import('./commands/instance/bookmark')).default,
      (await import('./commands/instance/forget')).default,
      (await import('./commands/instance/create')).default,
      (await import('./commands/instance/delete')).default,
      (await import('./commands/instance/status')).default,
      (await import('./commands/instance/active')).default,
      (await import('./commands/instance/use')).default,
      withKernelOptions((await import('./commands/instance/install')).default),
    ],
  })

  registerGroup(program, {
    name: 'identity',
    description: 'Manage CLI identities & delegation keypairs',
    commands: [
      (await import('./commands/identity/create')).default,
      (await import('./commands/identity/register')).default,
      (await import('./commands/identity/list')).default,
      (await import('./commands/identity/use')).default,
      (await import('./commands/identity/whoami')).default,
      (await import('./commands/identity/delete')).default,
      (await import('./commands/identity/sync')).default,
      (await import('./commands/identity/unsync')).default,
      (await import('./commands/identity/export')).default,
      (await import('./commands/identity/import')).default,
    ],
  })

  registerGroup(program, {
    name: 'auth',
    description: 'Astrale cloud authentication (stubbed in v1)',
    commands: [
      (await import('./commands/auth/login')).default,
      (await import('./commands/auth/logout')).default,
      (await import('./commands/auth/status')).default,
    ],
  })

  registerGroup(program, {
    name: 'tunnel',
    description: 'Machine-level cloudflared tunnels',
    commands: [
      (await import('./commands/tunnel/setup')).default,
      (await import('./commands/tunnel/adopt')).default,
      (await import('./commands/tunnel/start')).default,
      (await import('./commands/tunnel/status')).default,
      (await import('./commands/tunnel/list')).default,
      (await import('./commands/tunnel/stop')).default,
    ],
  })

  registerGroup(program, {
    name: 'graph',
    description: 'Manage FalkorDB graphs',
    commands: [
      (await import('./commands/graph/list')).default,
      (await import('./commands/graph/prune')).default,
      (await import('./commands/graph/rm')).default,
      (await import('./commands/graph/df')).default,
    ],
  })

  registerGroup(program, {
    name: 'server',
    description: 'Manager server lifecycle (docker image + container logs)',
    commands: [
      (await import('./commands/server/build')).default,
      (await import('./commands/server/logs')).default,
    ],
  })

  registerGroup(program, {
    name: 'domain',
    description: 'Manage kernel domains (lifecycle: init/dev/build/deploy)',
    commands: [
      (await import('./commands/domain/init')).default,
      (await import('./commands/domain/build')).default,
      (await import('./commands/domain/deploy')).default,
      (await import('./commands/domain/check')).default,
      (await import('./commands/domain/logs')).default,
      (await import('./commands/domain/instance-prepare')).default,
    ],
    subgroups: [
      {
        name: 'dev',
        description:
          'Local dev infrastructure lifecycle (replaces `pnpm infra:prepare`/`infra:down`)',
        commands: [
          (await import('./commands/domain/dev/up')).default,
          (await import('./commands/domain/dev/down')).default,
          (await import('./commands/domain/dev/status')).default,
        ],
      },
    ],
  })

  program.addHelpText(
    'after',
    `
Command groups:
  Lifecycle     init, start, stop, restart, status, reset, bootstrap
  Graph         ls, get, call, query, describe, logs, token
  Management    instance, identity, auth, tunnel
  Storage       graph list, graph prune, graph rm, graph df
  Server        server build, server logs
  Domains       domain init, domain build, domain deploy, domain check,
                domain logs, domain instance-prepare, domain dev (up|down|status)

Path syntax:
  /domain                        Domain node
  /domain/class.Name             Class node     (or /domain/interface.Name)
  /domain/class.Name/method      Static method  — single slash
                                 (interface-hosted static: /domain/interface.Name/method)
  <nodePath>::method             Instance method dispatch — double colon ::
  @nodeId                        Reference a node by its UID
  @nodeId::method                Instance method on a node by UID

Examples:
  $ astrale ls /
  $ astrale start && astrale bootstrap
  $ astrale call /manager.astrale.ai/class.KernelInstance/list
  $ astrale instance bookmark staging --url https://kernel.example.com
  $ astrale instance create my-app --local --install ./dist/spec.json
  $ astrale instance status staging
  $ astrale token --audience dist.astrale.ai --ttl 3600
  $ astrale logs --topic 'op:*:failed' -n 10
  $ astrale query 'MATCH (n) RETURN n LIMIT 5'
`,
  )

  return program
}
