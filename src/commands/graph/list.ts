import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { readConfig } from '../../lib/config'
import {
  type GraphInfo,
  resolveGraphStatuses,
  colorStatus,
  formatStats,
  handleGraphError,
} from '../../lib/graph'
import { log, spinner } from '../../lib/log'
import { isRawOutput, output, type OutputOpts } from '../../lib/output'

type ListOpts = OutputOpts & { orphaned?: boolean }

export default {
  name: 'list',
  description: 'List all FalkorDB graphs with their status',
  options: [
    { flags: '--orphaned', description: 'Only show orphaned graphs' },
    { flags: '--raw', description: 'Output raw JSON' },
    { flags: '--json', description: 'Alias for --raw' },
    { flags: '--format <type>', description: 'Output format', choices: ['yaml', 'json'] },
  ],
  action: async (opts: ListOpts) => {
    const isRaw = isRawOutput(opts)
    const spin = !isRaw ? spinner('Scanning graphs...') : null
    const config = await readConfig()

    try {
      const { graphs, summary, managerReachable } = await resolveGraphStatuses(config)
      spin?.succeed('Graphs scanned')

      if (!managerReachable && !isRaw) {
        log.warn('Manager not reachable — cannot determine which graphs are in-use')
      }

      let filtered = graphs
      if (opts.orphaned) {
        filtered = graphs.filter((g) => g.status === 'orphaned')
      }

      if (isRaw || opts.format) {
        output({ graphs: filtered, summary }, opts)
        return
      }

      if (filtered.length === 0) {
        console.log('')
        log.dim(opts.orphaned ? '  No orphaned graphs.' : '  No graphs found.')
        return
      }

      console.log('')
      printGraphTable(filtered)
    } catch (e) {
      spin?.fail('Failed')
      log.error(e instanceof Error ? e.message : String(e))
      handleGraphError(e)
      process.exit(1)
    }
  },
} satisfies CommandDefinition

function printGraphTable(graphs: GraphInfo[]): void {
  const nameW = Math.max(5, ...graphs.map((g) => g.name.length))

  const header = `  ${chalk.bold('GRAPH'.padEnd(nameW))}  ${chalk.bold('NODES'.padStart(5))}  ${chalk.bold('EDGES'.padStart(5))}  ${chalk.bold('STATUS')}     ${chalk.bold('INSTANCE')}`
  console.log(header)

  for (const g of graphs) {
    const { nodes, edges } = formatStats(g.stats)
    const name = g.name.padEnd(nameW)
    const status = colorStatus(g.status).padEnd(18)
    const instance = chalk.dim(g.instance ?? '-')
    console.log(
      `  ${chalk.cyan(name)}  ${nodes.padStart(5)}  ${edges.padStart(5)}  ${status} ${instance}`,
    )
  }
}
