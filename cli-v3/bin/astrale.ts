#!/usr/bin/env bun
import { Command } from 'commander'

const program = new Command()

program
  .name('astrale')
  .description('Astrale system CLI — manage your local Astrale installation')
  .version('0.1.0')
  .action(() => { program.help() })

program
  .command('init')
  .description('Set up a new Astrale installation')
  .action(async () => {
    const { initCommand } = await import('../src/commands/init')
    await initCommand()
  })

program
  .command('start')
  .description('Start the Astrale manager')
  .option('--foreground', 'Run in foreground (used by daemon)')
  .action(async (opts) => {
    const { startCommand } = await import('../src/commands/start')
    await startCommand(opts)
  })

program
  .command('stop')
  .description('Stop the Astrale manager')
  .action(async () => {
    const { stopCommand } = await import('../src/commands/stop')
    await stopCommand()
  })

program
  .command('restart')
  .description('Restart the Astrale manager')
  .option('--foreground', 'Run in foreground (used by daemon)')
  .action(async (opts) => {
    const { restartCommand } = await import('../src/commands/restart')
    await restartCommand(opts)
  })

program
  .command('status')
  .description('Show the status of the Astrale manager')
  .action(async () => {
    const { statusCommand } = await import('../src/commands/status')
    await statusCommand()
  })

program
  .command('reset')
  .description('Clear and reboot a kernel instance (wipes all graph data)')
  .option('-i, --instance <id>', 'Target instance (defaults to first)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts) => {
    const { resetCommand } = await import('../src/commands/reset')
    await resetCommand(opts)
  })

program
  .command('use')
  .description('Set the active kernel instance')
  .argument('<name>', 'Instance name (auto-registers as local if not known)')
  .action(async (name) => {
    const { useCommand } = await import('../src/commands/use')
    await useCommand(name)
  })

program
  .command('call')
  .description('Call a kernel operation')
  .argument('<method>', 'Full operation path (e.g., /manager.astrale.ai/KernelInstance/list)')
  .argument('[params...]', 'Params as key=value pairs')
  .option('-d, --data <json>', 'Params as JSON string')
  .option('--format <type>', 'Output format: yaml (default) or json')
  .option('--raw', 'Output raw JSON (no colors)')
  .option('--json', 'Alias for --raw')
  .option('-i, --instance <name>', 'Target a specific instance (overrides active)')
  .option('--timeout <ms>', 'Request timeout in ms', '30000')
  .option('--as <identity>', 'Call as a specific identity')
  .action(async (method, params, opts) => {
    const { callCommand } = await import('../src/commands/call')
    await callCommand(method, params, opts)
  })

program
  .command('get')
  .description('Get a node by path or ID')
  .argument('<path>', 'Node path (/domain/Class) or ID (@nodeId)')
  .option('--format <type>', 'Output format: yaml (default) or json')
  .option('--raw', 'Output raw JSON')
  .option('--json', 'Alias for --raw')
  .option('-i, --instance <name>', 'Target a specific instance (overrides active)')
  .option('--timeout <ms>', 'Request timeout in ms', '30000')
  .option('--as <identity>', 'Call as a specific identity')
  .action(async (path, opts) => {
    const { getCommand } = await import('../src/commands/get')
    await getCommand(path, opts)
  })

program
  .command('ls')
  .description('List children of a node')
  .argument('<path>', 'Node path (/domain/Class) or ID (@nodeId)')
  .option('--format <type>', 'Output format: yaml (default) or json')
  .option('--raw', 'Output raw JSON')
  .option('--json', 'Alias for --raw')
  .option('-i, --instance <name>', 'Target a specific instance (overrides active)')
  .option('--timeout <ms>', 'Request timeout in ms', '30000')
  .option('--as <identity>', 'Call as a specific identity')
  .action(async (path, opts) => {
    const { lsCommand } = await import('../src/commands/ls')
    await lsCommand(path, opts)
  })

program
  .command('logs')
  .description('View kernel event journal')
  .option('-t, --tail', 'Live stream new events')
  .option('-n <count>', 'Number of entries to show', '20')
  .option('--topic <pattern>', 'Filter by topic glob (e.g., op:*:failed)')
  .option('--since <time>', 'Show events since (e.g., 5m, 1h, ISO timestamp)')
  .option('--principal <name>', 'Filter by identity')
  .option('--trace <id>', 'Filter by trace/operation ID')
  .option('--timing', 'Show per-step timing breakdown')
  .option('--raw', 'Output raw NDJSON')
  .option('--json', 'Alias for --raw')
  .option('-i, --instance <name>', 'Show logs for a specific instance (overrides active)')
  .action(async (opts) => {
    const { logsCommand } = await import('../src/commands/logs')
    await logsCommand(opts)
  })

program
  .command('query')
  .description('Run a read-only Cypher query against the kernel graph')
  .argument('<cypher>', 'Cypher query string')
  .option('--format <type>', 'Output format: yaml (default) or json')
  .option('--raw', 'Output raw JSON (no colors)')
  .option('--json', 'Alias for --raw')
  .option('-i, --instance <name>', 'Target a specific instance (overrides active)')
  .option('--timeout <ms>', 'Request timeout in ms', '30000')
  .option('--as <identity>', 'Call as a specific identity')
  .action(async (cypher, opts) => {
    const { queryCommand } = await import('../src/commands/query')
    await queryCommand(cypher, opts)
  })

const instance = program.command('instance').description('Manage kernel instances')

instance
  .command('list')
  .description('List all registered instances')
  .action(async () => {
    const { instanceListCommand } = await import('../src/commands/instance')
    await instanceListCommand()
  })

instance
  .command('add')
  .description('Register a kernel instance')
  .argument('<name>', 'Instance name')
  .option('--url <ws-url>', 'WebSocket URL (for remote instances)')
  .action(async (name, opts) => {
    const { instanceAddCommand } = await import('../src/commands/instance')
    await instanceAddCommand(name, opts)
  })

instance
  .command('remove')
  .description('Remove a registered instance')
  .argument('<name>', 'Instance name')
  .action(async (name) => {
    const { instanceRemoveCommand } = await import('../src/commands/instance')
    await instanceRemoveCommand(name)
  })

instance
  .command('active')
  .description('Show the currently active instance')
  .action(async () => {
    const { instanceActiveCommand } = await import('../src/commands/instance')
    await instanceActiveCommand()
  })

const identity = program.command('identity').description('Manage CLI identities')

identity
  .command('create')
  .description('Create a new identity')
  .argument('<name>', 'Identity name')
  .option('--subject <sub>', 'Custom subject (defaults to name)')
  .action(async (name, opts) => {
    const { identityCreateCommand } = await import('../src/commands/identity')
    await identityCreateCommand(name, opts)
  })

identity
  .command('list')
  .description('List all identities')
  .action(async () => {
    const { identityListCommand } = await import('../src/commands/identity')
    await identityListCommand()
  })

identity
  .command('use')
  .description('Set the default identity')
  .argument('<name>', 'Identity name')
  .action(async (name) => {
    const { identityUseCommand } = await import('../src/commands/identity')
    await identityUseCommand(name)
  })

identity
  .command('whoami')
  .description('Show the current default identity')
  .action(async () => {
    const { identityWhoamiCommand } = await import('../src/commands/identity')
    await identityWhoamiCommand()
  })

identity
  .command('delete')
  .description('Delete an identity')
  .argument('<name>', 'Identity name')
  .action(async (name) => {
    const { identityDeleteCommand } = await import('../src/commands/identity')
    await identityDeleteCommand(name)
  })

program.parse()
