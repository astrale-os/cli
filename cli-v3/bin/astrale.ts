#!/usr/bin/env bun
import { Command } from 'commander'

const program = new Command()

program
  .name('astrale')
  .description('Astrale system CLI — manage your local Astrale installation')
  .version('0.1.0')

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
  .command('call')
  .description('Call a kernel operation')
  .argument('<method>', 'Full operation path (e.g., /manager.astrale.ai/KernelInstance/list)')
  .argument('[params...]', 'Params as key=value pairs')
  .option('-d, --data <json>', 'Params as JSON string')
  .option('--raw', 'Output raw JSON (no colors)')
  .option('--json', 'Alias for --raw')
  .option('-r, --remote <name-or-url>', 'Named target or full WS URL')
  .option('-i, --instance <id>', 'Target a local kernel instance')
  .option('--timeout <ms>', 'Request timeout in ms', '30000')
  .option('--as <identity>', 'Call as a specific identity')
  .action(async (method, params, opts) => {
    const { callCommand } = await import('../src/commands/call')
    await callCommand(method, params, opts)
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
  .option('--raw', 'Output raw NDJSON')
  .option('--json', 'Alias for --raw')
  .action(async (opts) => {
    const { logsCommand } = await import('../src/commands/logs')
    await logsCommand(opts)
  })

program
  .command('query')
  .description('Run a read-only Cypher query against the kernel graph')
  .argument('<cypher>', 'Cypher query string')
  .option('--raw', 'Output raw JSON (no colors)')
  .option('--json', 'Alias for --raw')
  .option('-r, --remote <name-or-url>', 'Named target or full WS URL')
  .option('-i, --instance <id>', 'Target a local kernel instance')
  .option('--timeout <ms>', 'Request timeout in ms', '30000')
  .option('--as <identity>', 'Call as a specific identity')
  .action(async (cypher, opts) => {
    const { queryCommand } = await import('../src/commands/query')
    await queryCommand(cypher, opts)
  })

const target = program.command('target').description('Manage kernel connection targets')

target
  .command('create')
  .description('Create a named target')
  .argument('<name>', 'Target name')
  .option('--url <ws-url>', 'WebSocket URL')
  .option('--instance <id>', 'Local kernel instance ID')
  .action(async (name, opts) => {
    const { targetCreateCommand } = await import('../src/commands/target')
    await targetCreateCommand(name, opts)
  })

target
  .command('list')
  .description('List all targets')
  .action(async () => {
    const { targetListCommand } = await import('../src/commands/target')
    await targetListCommand()
  })

target
  .command('use')
  .description('Set the default target')
  .argument('<name>', 'Target name')
  .action(async (name) => {
    const { targetUseCommand } = await import('../src/commands/target')
    await targetUseCommand(name)
  })

target
  .command('whoami')
  .description('Show the current default target')
  .action(async () => {
    const { targetWhoamiCommand } = await import('../src/commands/target')
    await targetWhoamiCommand()
  })

target
  .command('delete')
  .description('Delete a target')
  .argument('<name>', 'Target name')
  .action(async (name) => {
    const { targetDeleteCommand } = await import('../src/commands/target')
    await targetDeleteCommand(name)
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
