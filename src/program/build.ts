import { Command, Option } from 'commander'

import pkg from '../../package.json' with { type: 'json' }
import { withKernelOptions } from './options'
import { registerCommand, registerGroup } from './registry'

/**
 * Build the fully-wired Commander program (every command + group registered)
 * WITHOUT parsing argv. `bin/astrale.ts` is a thin shim that calls this and
 * `.parse()`; tests import it to walk the command tree (the `--help` surface
 * is asserted to be the source of truth it claims to be — see
 * `program/__tests__/program.test.ts`).
 */
export async function buildProgram(): Promise<Command> {
  const program = new Command()

  program
    .name('astrale')
    .description('Astrale CLI — connect to existing Astrale kernels')
    // Single source of truth = package.json (bumped by release-please together
    // with .release-please-manifest.json). Never hand-write a version literal.
    .version(pkg.version, '-V, --cli-version', 'output the CLI version (root alias: --version)')
    .showSuggestionAfterError(true)
    .addOption(new Option('--ci', 'Machine mode: no prompts, structured errors on stderr'))
    .addOption(new Option('--no-prompt', 'Disable interactive prompts'))
    .action(async () => {
      // Bare `astrale` in an interactive terminal with nothing connected yet →
      // launch the guided setup. Otherwise (configured, piped, or CI) show help.
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const { shouldAutostartSetup } = await import('../setup/engine')
        if (await shouldAutostartSetup()) {
          await (await import('../commands/setup')).default.action(undefined, {})
          return
        }
      }
      program.help()
    })

  // Verbatim alias of `identity whoami` — defer to the command-definition
  // module so options stay in sync.
  const whoamiMod = await import('../commands/identity/whoami')
  registerCommand(program, {
    name: 'whoami',
    description: 'Show the current default identity (alias for identity whoami)',
    options: whoamiMod.default.options,
    action: whoamiMod.default.action,
  })
  registerCommand(program, (await import('../commands/setup')).default)
  registerCommand(program, (await import('../commands/use')).default)
  registerCommand(program, (await import('../commands/update')).default)

  // ── Graph / kernel ─────────────────────────────────────────────
  registerCommand(program, withKernelOptions((await import('../commands/call')).default))
  registerCommand(program, withKernelOptions((await import('../commands/token')).default))
  registerCommand(program, withKernelOptions((await import('../commands/get')).default))
  registerCommand(program, withKernelOptions((await import('../commands/mutate')).default))
  registerCommand(program, withKernelOptions((await import('../commands/query')).default))
  registerCommand(program, withKernelOptions((await import('../commands/introspect')).default))
  registerCommand(program, withKernelOptions((await import('../commands/logs')).default))
  registerCommand(program, withKernelOptions((await import('../commands/view')).default))
  registerCommand(program, (await import('../commands/status')).default)
  registerCommand(program, (await import('../commands/browser')).default)
  registerCommand(program, (await import('../commands/view-serve')).default)
  registerCommand(program, (await import('../commands/studio')).default)

  registerGroup(program, {
    name: 'skills',
    description: 'Manage embedded Astrale skills globally',
    commands: [
      (await import('../commands/skills/status')).default,
      (await import('../commands/skills/update')).default,
      (await import('../commands/skills/configure')).default,
    ],
  })

  registerGroup(program, {
    name: 'ui',
    description: 'Initialize and install Astrale UI in local applications',
    commands: [
      (await import('../commands/ui/init')).default,
      (await import('../commands/ui/search')).default,
      (await import('../commands/ui/add')).default,
      (await import('../commands/ui/doctor')).default,
    ],
    subgroups: [
      {
        name: 'preset',
        description: 'List and apply qualified Astrale UI presets',
        commands: [
          (await import('../commands/ui/preset-list')).default,
          (await import('../commands/ui/preset-apply')).default,
        ],
      },
    ],
  })

  registerGroup(program, {
    name: 'instance',
    description: 'Manage admin-provisioned instances and local bookmarks',
    commands: [
      withKernelOptions((await import('../commands/instance/list')).default),
      (await import('../commands/instance/bookmark')).default,
      (await import('../commands/instance/forget')).default,
      withKernelOptions((await import('../commands/instance/create')).default),
      withKernelOptions((await import('../commands/instance/delete')).default),
      withKernelOptions((await import('../commands/instance/status')).default),
      (await import('../commands/instance/active')).default,
      (await import('../commands/instance/use')).default,
    ],
  })

  registerGroup(program, {
    name: 'domain',
    description: 'List, publish, install, and uninstall domains',
    commands: [
      withKernelOptions((await import('../commands/domain/list')).default),
      withKernelOptions((await import('../commands/domain/publish')).default),
      withKernelOptions((await import('../commands/domain/install')).default),
      withKernelOptions((await import('../commands/domain/uninstall')).default),
    ],
  })

  registerGroup(program, {
    name: 'admin',
    description: 'Configure the admin kernel',
    commands: [
      (await import('../commands/admin/status')).default,
      (await import('../commands/admin/use')).default,
    ],
  })

  registerGroup(program, {
    name: 'identity',
    description: 'Manage CLI identities & delegation keypairs',
    commands: [
      (await import('../commands/identity/create')).default,
      withKernelOptions((await import('../commands/identity/register')).default),
      (await import('../commands/identity/list')).default,
      (await import('../commands/identity/use')).default,
      (await import('../commands/identity/whoami')).default,
      (await import('../commands/identity/delete')).default,
      (await import('../commands/identity/sync')).default,
      (await import('../commands/identity/unsync')).default,
      (await import('../commands/identity/export')).default,
      (await import('../commands/identity/import')).default,
    ],
  })

  registerGroup(program, {
    name: 'auth',
    description: 'Authenticate with configured identity providers',
    commands: [
      (await import('../commands/auth/login')).default,
      (await import('../commands/auth/token')).default,
      (await import('../commands/auth/logout')).default,
      (await import('../commands/auth/status')).default,
    ],
  })

  registerGroup(program, {
    name: 'session',
    description: 'Locally recorded work sessions: list and DX-analyze them',
    commands: [
      (await import('../commands/session/list')).default,
      (await import('../commands/session/analyze')).default,
    ],
  })

  registerGroup(program, {
    name: 'idp',
    description: 'Manage OpenID Connect identity providers',
    commands: [
      (await import('../commands/idp/add')).default,
      (await import('../commands/idp/list')).default,
      (await import('../commands/idp/show')).default,
      (await import('../commands/idp/refresh')).default,
      (await import('../commands/idp/remove')).default,
    ],
  })

  program.addHelpText(
    'after',
    `
Command groups:
  Getting started  setup     (sign in, pick an instance, equip your workspace)
  Kernel        get, mutate, call, query, introspect, logs, view, token
  Management    admin, instance, domain, identity, auth, idp, update
  Application   ui        (initialize, inspect, and install Astrale UI source)
  Agent         browser, skills   (drive the GUI; configure global agent skills)
  Studio        studio    (launch the local Domain Studio GUI for a workspace)

Path syntax:
  /:origin                       Domain root
  /:origin:class.Name            Class node
  /:origin:class.Name:method     Static callable
  <nodePath>::method             Instance method dispatch — double colon ::
  @nodeId                        Reference a node by its UID
  @nodeId::method                Instance method on a node by UID

Examples:
  $ astrale studio
  $ astrale admin status
  $ astrale update --check
  $ astrale instance bookmark staging --url https://kernel.example.com
  $ astrale instance create my-app
  $ astrale instance status staging
  $ astrale token --audience shell.astrale.ai
  $ astrale query /:notes.example.dev:class.Note --limit 50
  $ astrale introspect /:kernel.astrale.ai:class.Identity:whois
  $ astrale query --file query.v6.json --cursor "$CURSOR"
`,
  )

  return program
}
