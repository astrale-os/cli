#!/usr/bin/env bun
import { Command } from 'commander'

import { registerCommand, registerGroup } from '../src/registry'

const program = new Command()

program
  .name('astrale')
  .description('Astrale system CLI — manage your local Astrale installation')
  .version('0.1.0')
  .showSuggestionAfterError(true)
  .action(() => {
    program.help()
  })

// ── Top-level commands ────────────────────────────────────────

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
  description: 'Start the Astrale manager',
  options: [{ flags: '--foreground', description: 'Run in foreground (used by daemon)' }],
  action: async (opts) => {
    const { startCommand } = await import('../src/commands/start')
    await startCommand(opts as { foreground?: boolean })
  },
})

registerCommand(program, {
  name: 'stop',
  description: 'Stop the Astrale manager',
  action: async () => {
    const { stopCommand } = await import('../src/commands/stop')
    await stopCommand()
  },
})

registerCommand(program, {
  name: 'restart',
  description: 'Restart the Astrale manager',
  options: [{ flags: '--foreground', description: 'Run in foreground (used by daemon)' }],
  action: async (opts) => {
    const { restartCommand } = await import('../src/commands/restart')
    await restartCommand(opts as { foreground?: boolean })
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
    { flags: '--raw', description: 'Output raw JSON' },
    { flags: '--json', description: 'Alias for --raw' },
  ],
  action: async (opts) => {
    const { statusCommand } = await import('../src/commands/status')
    await statusCommand(opts as Parameters<typeof statusCommand>[0])
  },
})

registerCommand(program, {
  name: 'reset',
  description: 'Clear and reboot a kernel instance (wipes all graph data)',
  options: [
    { flags: '-i, --instance <id>', description: 'Target instance (defaults to first)' },
    { flags: '-y, --yes', description: 'Skip confirmation prompt' },
  ],
  action: async (opts) => {
    const { resetCommand } = await import('../src/commands/reset')
    await resetCommand(opts as { instance?: string; yes?: boolean })
  },
})

registerCommand(program, {
  name: 'use',
  description: 'Set the active kernel instance (no args: show current)',
  aliases: ['switch'],
  arguments: [{ name: 'name', description: 'Registered instance name', required: false }],
  action: async (name) => {
    const { useCommand } = await import('../src/commands/use')
    await useCommand(name as string | undefined)
  },
})

registerCommand(program, {
  name: 'whoami',
  description: 'Show the current default identity (alias for identity whoami)',
  options: [
    { flags: '--raw', description: 'Output raw JSON' },
    { flags: '--json', description: 'Alias for --raw' },
  ],
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
  { flags: '--raw', description: 'Output raw JSON (no colors)' },
  { flags: '--json', description: 'Alias for --raw' },
  {
    flags: '--url <url>',
    description: 'Target a kernel URL directly (overrides instance resolution)',
  },
  { flags: '-i, --instance <name>', description: 'Target a specific instance (overrides active)' },
  { flags: '--timeout <ms>', description: 'Request timeout in ms', default: '30000' },
  { flags: '--as <identity>', description: 'Call as a specific identity' },
  { flags: '--debug', description: 'Print full error diagnostics on failure' },
]

registerCommand(program, {
  name: 'call',
  description: 'Call a kernel operation',
  arguments: [
    {
      name: 'path',
      description: 'Operation path (e.g., /manager.astrale.ai/KernelInstance/list or /node:method)',
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
  options: kernelOptions,
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

// ── Command groups ────────────────────────────────────────────

registerGroup(program, {
  name: 'instance',
  description: 'Manage kernel instances',
  commands: [
    (await import('../src/commands/instance/list')).default,
    (await import('../src/commands/instance/add')).default,
    (await import('../src/commands/instance/remove')).default,
    (await import('../src/commands/instance/active')).default,
  ],
})

registerGroup(program, {
  name: 'identity',
  description: 'Manage CLI identities',
  commands: [
    (await import('../src/commands/identity/create')).default,
    (await import('../src/commands/identity/list')).default,
    (await import('../src/commands/identity/use')).default,
    (await import('../src/commands/identity/whoami')).default,
    (await import('../src/commands/identity/delete')).default,
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

// ── Help text enhancements ───────────────────────────────────

program.addHelpText(
  'after',
  `
Command groups:
  Lifecycle     init, start, stop, restart, status, reset
  Graph         ls, get, call, query, describe, logs
  Management    instance, identity, use
  Storage       graph list, graph prune, graph rm, graph df

Path syntax:
  /domain/Class/method    Navigate to a Syscall node (static operation)
  /domain/Class:method    Call a method on a node instance
  @nodeId                 Reference a node by its ID

Examples:
  $ astrale ls /
  $ astrale call /manager.astrale.ai/KernelInstance/list
  $ astrale call /manager.astrale.ai/KernelInstance/register id=my-inst graphName=my-graph
  $ astrale get /kernel.astrale.ai/Domain
  $ astrale describe /manager.astrale.ai/KernelInstance
  $ astrale logs --topic 'op:*:failed' -n 10
  $ astrale query 'MATCH (n) RETURN n LIMIT 5'
`,
)

program.parse()
