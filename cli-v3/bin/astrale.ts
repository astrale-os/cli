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
  .command('status')
  .description('Show the status of the Astrale manager')
  .action(async () => {
    const { statusCommand } = await import('../src/commands/status')
    await statusCommand()
  })

program
  .command('call')
  .description('Call a kernel operation')
  .argument('<method>', 'Full operation path (e.g., /manager.astrale.ai/KernelInstance/list)')
  .argument('[params...]', 'Params as key=value pairs')
  .option('-d, --data <json>', 'Params as JSON string')
  .option('--raw', 'Output raw JSON (no colors)')
  .option('--json', 'Alias for --raw')
  .option('--kernel <url>', 'Override kernel WebSocket URL')
  .option('--timeout <ms>', 'Request timeout in ms', '30000')
  .option('--as <identity>', 'Call as a specific identity')
  .action(async (method, params, opts) => {
    const { callCommand } = await import('../src/commands/call')
    await callCommand(method, params, opts)
  })

program
  .command('query')
  .description('Run a read-only Cypher query against the kernel graph')
  .argument('<cypher>', 'Cypher query string')
  .option('--raw', 'Output raw JSON (no colors)')
  .option('--json', 'Alias for --raw')
  .option('--kernel <url>', 'Override kernel WebSocket URL')
  .option('--timeout <ms>', 'Request timeout in ms', '30000')
  .option('--as <identity>', 'Call as a specific identity')
  .action(async (cypher, opts) => {
    const { queryCommand } = await import('../src/commands/query')
    await queryCommand(cypher, opts)
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
