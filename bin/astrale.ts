#!/usr/bin/env bun
import { Command, Option } from 'commander'

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

registerCommand(program, {
  name: 'init',
  description: 'Set up a new Astrale installation',
  options: [
    { flags: '--manager-port <port>', description: 'Manager HTTP port (default: 4400)' },
    { flags: '--ui-port <port>', description: 'Playground UI port (default: 4300)' },
    { flags: '--falkor-port <port>', description: 'FalkorDB port (default: 6379)' },
    { flags: '--graph-name <name>', description: 'Graph name (default: astrale-manager)' },
    { flags: '-y, --yes', description: 'Skip prompts and accept defaults / overwrite' },
  ],
  action: async (opts) => {
    const { initCommand } = await import('../src/commands/init')
    await initCommand(opts as Parameters<typeof initCommand>[0])
  },
})

registerCommand(program, {
  name: 'start',
  description: 'Start the Astrale manager (docker-mode by default) + playground + gui dev servers',
  options: [
    { flags: '--foreground', description: 'Run in foreground (host-mode only)' },
    {
      flags: '--host-mode',
      description: 'Run the manager as a bun process on the host instead of docker',
    },
    {
      flags: '--no-ui',
      description: 'Skip spawning playground + gui dev servers (run them manually)',
    },
  ],
  action: async (opts) => {
    const { startCommand } = await import('../src/commands/start')
    await startCommand(opts as Parameters<typeof startCommand>[0])
  },
})

registerCommand(program, {
  name: 'stop',
  description: 'Stop the Astrale manager (both modes by default)',
  options: [
    {
      flags: '--host-mode',
      description: 'Only target the host-mode manager (skip docker)',
    },
  ],
  action: async (opts) => {
    const { stopCommand } = await import('../src/commands/stop')
    await stopCommand(opts as Parameters<typeof stopCommand>[0])
  },
})

registerCommand(program, {
  name: 'restart',
  description: 'Restart the Astrale manager',
  options: [
    { flags: '--foreground', description: 'Run in foreground (host-mode only)' },
    {
      flags: '--host-mode',
      description: 'Run the manager as a bun process on the host instead of docker',
    },
    {
      flags: '--no-ui',
      description: 'Skip spawning playground + gui dev servers (run them manually)',
    },
  ],
  action: async (opts) => {
    const { restartCommand } = await import('../src/commands/restart')
    await restartCommand(opts as Parameters<typeof restartCommand>[0])
  },
})

registerCommand(program, {
  name: 'status',
  description: 'Show the status of the Astrale manager',
  options: [
    {
      flags: '--format <type>',
      description: 'Output format (default: yaml in TTY, json when piped)',
      choices: ['yaml', 'json'],
    },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (opts) => {
    const { statusCommand } = await import('../src/commands/status')
    await statusCommand(opts as Parameters<typeof statusCommand>[0])
  },
})

registerCommand(program, {
  name: 'reset',
  description: 'Clear and reboot the active instance (wipes all graph data)',
  options: [
    { flags: '-i, --instance <id>', description: 'Target instance (defaults to active)' },
    { flags: '-y, --yes', description: 'Skip confirmation prompt' },
    {
      flags: '--hard',
      description:
        'Fresh-install wipe: stop everything, remove containers, delete every Astrale state file (identities, keys, tunnels, FalkorDB data). Always succeeds even if services are dead.',
    },
    {
      flags: '--host-mode',
      description: 'Reset the host-mode manager (default: docker-mode if detected)',
    },
  ],
  action: async (opts) => {
    const { resetCommand } = await import('../src/commands/reset')
    await resetCommand(opts as Parameters<typeof resetCommand>[0])
  },
})

registerCommand(program, {
  name: 'use',
  description: 'Deprecated alias — use `astrale instance use <name>` instead (kept for transition)',
  aliases: ['switch'],
  arguments: [{ name: 'name', description: 'Registered instance name', required: false }],
  options: [
    {
      flags: '--adopt-default',
      description: 'Adopt instance default identity without prompt (§7.1)',
    },
    { flags: '--skip-jwks-check', description: 'Skip the /meta ↔ JWKS match check (§7)' },
  ],
  action: async (name, opts) => {
    const { log } = await import('../src/lib/log')
    log.warn('`astrale use` is deprecated — use `astrale instance use` instead.')
    const { useCommand } = await import('../src/commands/use')
    await useCommand(name as string | undefined, opts as Parameters<typeof useCommand>[1])
  },
})

registerCommand(program, {
  name: 'whoami',
  description: 'Show the current default identity (alias for identity whoami)',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts) => {
    const mod = await import('../src/commands/identity/whoami')
    await mod.default.action(opts as { raw?: boolean; json?: boolean })
  },
})

const kernelOptions = [
  {
    flags: '--format <type>',
    description: 'Output format (default: yaml in TTY, json when piped)',
    choices: ['yaml', 'json'],
  },
  ...RAW_OUTPUT_OPTIONS,
  {
    flags: '--url <url>',
    description: 'Target a kernel URL directly (overrides instance resolution)',
  },
  { flags: '-i, --instance <name>', description: 'Target a specific instance (overrides active)' },
  { flags: '--timeout <ms>', description: 'Request timeout in ms', default: '30000' },
  { flags: '--as <identity>', description: 'Call as a specific identity' },
  { flags: '--creds <token>', description: 'Use a pre-signed credential (e.g. delegation token)' },
  { flags: '--debug', description: 'Print full error diagnostics on failure' },
]

registerCommand(program, {
  name: 'call',
  description: 'Call a kernel operation',
  arguments: [
    {
      name: 'path',
      description:
        'Operation path (e.g., /manager.astrale.ai/class.KernelInstance/list or /node::method)',
    },
    { name: 'params...', description: 'Params as key=value pairs', required: false },
  ],
  options: [
    { flags: '-d, --data <json>', description: 'Params as JSON string' },
    { flags: '--describe', description: 'Show operation schema without executing' },
    { flags: '--dry-run', description: 'Show what would be sent without executing' },
    ...kernelOptions,
  ],
  action: async (path, params, opts) => {
    const { callCommand } = await import('../src/commands/call')
    await callCommand(path as string, params as string[], opts)
  },
})

registerCommand(program, {
  name: 'token',
  description: 'Mint a fresh delegation token for the active instance + identity (§9)',
  options: [
    { flags: '--audience <aud>', description: 'Token audience (defaults to instance domain)' },
    { flags: '--ttl <sec>', description: 'TTL in seconds (default: 3600)' },
    { flags: '--for <identity>', description: 'Mint the token for this identity (alias of --as)' },
    ...kernelOptions,
  ],
  action: async (opts) => {
    const { tokenCommand } = await import('../src/commands/token')
    await tokenCommand(opts as Parameters<typeof tokenCommand>[0])
  },
})

registerCommand(program, {
  name: 'get',
  description: 'Get a node by path or ID',
  arguments: [{ name: 'path', description: 'Node path (/domain/Class) or ID (@nodeId)' }],
  options: [
    { flags: '-l, --long', description: 'Include all internal fields (__labels, classId)' },
    ...kernelOptions,
  ],
  action: async (path, opts) => {
    const { getCommand } = await import('../src/commands/get')
    await getCommand(path as string, opts as Parameters<typeof getCommand>[1])
  },
})

registerCommand(program, {
  name: 'ls',
  description: 'List children of a node',
  arguments: [{ name: 'path', description: 'Node path (/domain/Class) or ID (@nodeId)' }],
  options: [
    { flags: '-l, --long', description: 'Full node dump (default: compact)' },
    { flags: '-q, --quiet', description: 'One path per line (unix-pipeable)' },
    { flags: '-R, --recursive', description: 'List recursively (tree view)' },
    { flags: '--count', description: 'Print only the number of children' },
    {
      flags: '--filter <kind>',
      description: 'Filter children by class or label (e.g., Class, Syscall)',
    },
    ...kernelOptions,
  ],
  action: async (path, opts) => {
    const { lsCommand } = await import('../src/commands/ls')
    await lsCommand(path as string, opts as Parameters<typeof lsCommand>[1])
  },
})

registerCommand(program, {
  name: 'describe',
  description: 'Describe a node: its kind, operations, children, and schemas',
  arguments: [{ name: 'path', description: 'Node path (/domain/Class) or ID (@nodeId)' }],
  options: [
    {
      flags: '--no-schema',
      description: 'Omit the serialized `schema` property (useful for Domain nodes, where it is multi-kB)',
    },
    ...kernelOptions,
  ],
  action: async (path, opts) => {
    const { describeCommand } = await import('../src/commands/describe')
    await describeCommand(path as string, opts)
  },
})

registerCommand(program, {
  name: 'logs',
  description: 'View kernel event journal',
  options: [
    { flags: '-t, --tail', description: 'Live stream new events' },
    { flags: '-n <count>', description: 'Number of entries to show', default: '20' },
    {
      flags: '--topic <pattern>',
      description:
        'Filter by topic glob (* matches one segment, ** matches rest. e.g., op:*:failed, sys:**)',
    },
    {
      flags: '--since <time>',
      description: 'Show events since (e.g., 5m, 1h, ISO timestamp)',
    },
    { flags: '--principal <name>', description: 'Filter by identity' },
    { flags: '--trace <id>', description: 'Filter by trace/operation ID' },
    { flags: '--timing', description: 'Show per-step timing breakdown' },
    {
      flags: '-c, --compact',
      description: 'Tab-separated summary (timestamp, topic, duration, result)',
    },
    { flags: '-v, --verbose', description: 'Show all events including :started phases' },
    { flags: '--raw', description: 'Output raw NDJSON' },
    { flags: '--json', description: 'Alias for --raw' },
    {
      flags: '-i, --instance <name>',
      description: 'Show logs for a specific instance (overrides active)',
    },
  ],
  action: async (opts) => {
    const { logsCommand } = await import('../src/commands/logs')
    await logsCommand(opts)
  },
})

registerCommand(program, {
  name: 'query',
  description: 'Run a read-only Cypher query against the kernel graph',
  arguments: [{ name: 'cypher', description: 'Cypher query string' }],
  options: kernelOptions,
  action: async (cypher, opts) => {
    const { queryCommand } = await import('../src/commands/query')
    await queryCommand(cypher as string, opts)
  },
})

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
    {
      ...(await import('../src/commands/instance/install')).default,
      options: [
        ...((await import('../src/commands/instance/install')).default.options ?? []),
        ...kernelOptions,
      ],
    },
  ],
})

registerGroup(program, {
  name: 'identity',
  description: 'Manage CLI identities (§2)',
  commands: [
    (await import('../src/commands/identity/create')).default,
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
      description: 'Local dev infrastructure lifecycle (replaces `pnpm infra:prepare`/`infra:down`)',
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
  Domains       domain init, domain build, domain deploy, domain check, domain logs

Path syntax:
  /domain/class.Name/method    Navigate to a Syscall node (static operation)
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
