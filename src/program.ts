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
    .description('Astrale CLI — connect to existing Astrale kernels')
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

  // Verbatim alias of `identity whoami` — defer to the command-definition
  // module so options stay in sync.
  const whoamiMod = await import('./commands/identity/whoami')
  registerCommand(program, {
    name: 'whoami',
    description: 'Show the current default identity (alias for identity whoami)',
    options: whoamiMod.default.options,
    action: whoamiMod.default.action,
  })
  registerCommand(program, (await import('./commands/use')).default)
  registerCommand(program, (await import('./commands/update')).default)

  // ── Graph / kernel ─────────────────────────────────────────────
  registerCommand(program, withKernelOptions((await import('./commands/call')).default))
  registerCommand(program, withKernelOptions((await import('./commands/token')).default))
  registerCommand(program, withKernelOptions((await import('./commands/get')).default))
  registerCommand(program, withKernelOptions((await import('./commands/ls')).default))
  registerCommand(program, withKernelOptions((await import('./commands/describe')).default))
  registerCommand(program, withKernelOptions((await import('./commands/query')).default))
  registerCommand(program, withKernelOptions((await import('./commands/logs')).default))
  registerCommand(program, (await import('./commands/status')).default)
  registerCommand(program, (await import('./commands/browser')).default)

  registerGroup(program, {
    name: 'instance',
    description: 'Manage admin-provisioned instances and local bookmarks',
    commands: [
      withKernelOptions((await import('./commands/instance/list')).default),
      (await import('./commands/instance/bookmark')).default,
      (await import('./commands/instance/forget')).default,
      withKernelOptions((await import('./commands/instance/create')).default),
      withKernelOptions((await import('./commands/instance/delete')).default),
      withKernelOptions((await import('./commands/instance/status')).default),
      (await import('./commands/instance/active')).default,
      (await import('./commands/instance/use')).default,
      withKernelOptions((await import('./commands/instance/install')).default),
    ],
  })

  registerGroup(program, {
    name: 'admin',
    description: 'Configure the admin control-plane kernel',
    commands: [
      (await import('./commands/admin/status')).default,
      (await import('./commands/admin/use')).default,
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
    description: 'Authenticate with configured identity providers',
    commands: [
      (await import('./commands/auth/login')).default,
      (await import('./commands/auth/token')).default,
      (await import('./commands/auth/logout')).default,
      (await import('./commands/auth/status')).default,
    ],
  })

  registerGroup(program, {
    name: 'idp',
    description: 'Manage OpenID Connect identity providers',
    commands: [
      (await import('./commands/idp/add')).default,
      (await import('./commands/idp/list')).default,
      (await import('./commands/idp/show')).default,
      (await import('./commands/idp/refresh')).default,
      (await import('./commands/idp/remove')).default,
    ],
  })

  program.addHelpText(
    'after',
    `
Command groups:
  Kernel        ls, get, call, query, describe, token
  Management    admin, instance, identity, auth, idp, update
  Agent         browser   (drive the GUI via agent-browser)

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
  $ astrale admin status
  $ astrale update --check
  $ astrale instance bookmark staging --url https://kernel.example.com
  $ astrale instance create my-app
  $ astrale instance status staging
  $ astrale token --audience dist.astrale.ai --ttl 3600
  $ astrale query 'MATCH (n) RETURN n LIMIT 5'
`,
  )

  return program
}
