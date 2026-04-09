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

export default {
  name: 'df',
  description: 'Show FalkorDB graph usage and reclaimable space',
  options: [
    { flags: '--raw', description: 'Output raw JSON' },
    { flags: '--json', description: 'Alias for --raw' },
  ],
  action: async (opts: OutputOpts) => {
    const isRaw = isRawOutput(opts)
    const spin = !isRaw ? spinner('Scanning graphs...') : null
    const config = await readConfig()

    try {
      const { graphs, summary, managerReachable } = await resolveGraphStatuses(config)
      spin?.succeed('Graphs scanned')

      if (!managerReachable && !isRaw) {
        log.warn('Manager not reachable — cannot determine which graphs are in-use')
      }

      const orphaned = graphs.filter((g) => g.status === 'orphaned')

      if (isRaw) {
        output(
          {
            graphs,
            summary,
            reclaimable: {
              graphs: orphaned.length,
              nodes: sumStat(orphaned, 'nodes'),
              edges: sumStat(orphaned, 'edges'),
            },
          },
          opts,
        )
        return
      }

      if (graphs.length === 0) {
        console.log('')
        log.dim('  No graphs found.')
        return
      }

      console.log('')
      printTable(graphs)

      // Summary footer
      console.log('')
      console.log(
        `  Total: ${chalk.bold(String(summary.total))} graphs, ${sumStat(graphs, 'nodes')} nodes, ${sumStat(graphs, 'edges')} edges`,
      )

      if (orphaned.length > 0) {
        console.log(
          chalk.yellow(
            `  Reclaimable: ${orphaned.length} orphaned graph(s) (${sumStat(orphaned, 'nodes')} nodes, ${sumStat(orphaned, 'edges')} edges)`,
          ),
        )
        log.dim('  Run `astrale graph prune` to clean up')
      } else {
        console.log(chalk.green('  No reclaimable graphs'))
      }
    } catch (e) {
      spin?.fail('Failed')
      log.error(e instanceof Error ? e.message : String(e))
      handleGraphError(e)
      process.exit(1)
    }
  },
} satisfies CommandDefinition

function printTable(graphs: GraphInfo[]): void {
  const nameW = Math.max(5, ...graphs.map((g) => g.name.length))

  const header = `  ${chalk.bold('GRAPH'.padEnd(nameW))}  ${chalk.bold('NODES'.padStart(5))}  ${chalk.bold('EDGES'.padStart(5))}  ${chalk.bold('STATUS')}`
  console.log(header)

  for (const g of graphs) {
    const { nodes, edges } = formatStats(g.stats)
    console.log(
      `  ${chalk.cyan(g.name.padEnd(nameW))}  ${nodes.padStart(5)}  ${edges.padStart(5)}  ${colorStatus(g.status)}`,
    )
  }
}

function sumStat(graphs: GraphInfo[], field: 'nodes' | 'edges'): number {
  return graphs.reduce((sum, g) => sum + (g.stats?.[field] ?? 0), 0)
}
