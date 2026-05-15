import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { readConfig } from '../../lib/config'
import {
  type GraphInfo,
  formatStats,
  resolveGraphStatuses,
  removeGraph,
  handleGraphError,
} from '../../lib/graph'
import { log, spinner } from '../../lib/log'
import { confirm, confirmWithInput } from '../../lib/prompt'

type PruneOpts = {
  all?: boolean
  includeManager?: boolean
  yes?: boolean
  dryRun?: boolean
}

export default {
  name: 'prune',
  description: 'Remove orphaned FalkorDB graphs',
  afterHelpText: `
Behavior:
  Removes orphaned graphs. --all also removes graphs of
  stopped/registered instances; --include-manager needs a double
  confirm; --dry-run shows what would be removed without deleting.

Examples:
  $ astrale graph prune --dry-run
  $ astrale graph prune --all
`,
  options: [
    { flags: '--all', description: 'Also remove graphs for stopped/registered instances' },
    { flags: '--include-manager', description: 'Include the manager graph (dangerous)' },
    { flags: '-y, --yes', description: 'Skip confirmation' },
    { flags: '--dry-run', description: 'Show what would be removed without deleting' },
  ],
  action: async (opts: PruneOpts) => {
    const config = await readConfig()
    const spin = spinner('Scanning graphs...')

    try {
      const { graphs, managerReachable } = await resolveGraphStatuses(config)
      spin.succeed('Graphs scanned')

      if (!managerReachable) {
        log.warn('Manager not reachable — cannot safely determine orphaned graphs')
        log.dim('  Start the manager first: astrale start')
        process.exit(1)
      }

      const toPrune = selectGraphsToPrune(graphs, opts, config.graphName)

      if (toPrune.length === 0) {
        log.success('Nothing to prune')
        return
      }

      // Show what will be removed
      const hasInUse = toPrune.some((g) => g.status === 'in-use')
      const hasManager = toPrune.some((g) => g.status === 'manager')

      console.log('')
      console.log(chalk.bold('  Graphs to remove:'))
      for (const g of toPrune) {
        const { nodes, edges } = formatStats(g.stats)
        const statsStr = chalk.dim(`${nodes} nodes, ${edges} edges`)
        const warning =
          g.status === 'manager'
            ? chalk.red(' (manager)')
            : g.status === 'in-use'
              ? chalk.red(' (in-use)')
              : ''
        console.log(`    ${chalk.yellow(g.name)}  ${statsStr}${warning}`)
      }
      console.log('')

      if (opts.dryRun) {
        log.dim(`  Dry run: would remove ${toPrune.length} graph(s)`)
        return
      }

      // Confirmation — escalate for dangerous operations
      if (!opts.yes) {
        if (hasManager) {
          const confirmed = await confirmWithInput(
            `This will delete ${toPrune.length} graph(s) including the manager graph.`,
            config.graphName,
          )
          if (!confirmed) {
            log.info('Aborted')
            return
          }
        } else if (hasInUse) {
          const confirmed = await confirmWithInput(
            `This will delete ${toPrune.length} graph(s) including graphs used by running instances.`,
            'delete-in-use',
          )
          if (!confirmed) {
            log.info('Aborted')
            return
          }
        } else {
          const confirmed = await confirm(`Remove ${toPrune.length} orphaned graph(s)?`)
          if (!confirmed) {
            log.info('Aborted')
            return
          }
        }
      }

      // Delete
      let deleted = 0
      for (const g of toPrune) {
        try {
          await removeGraph(config, g.name)
          log.success(`Deleted ${g.name}`)
          deleted++
        } catch (e) {
          log.error(`Failed to delete ${g.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      log.success(`Pruned ${deleted} graph(s)`)
    } catch (e) {
      spin.fail('Failed')
      log.error(e instanceof Error ? e.message : String(e))
      handleGraphError(e)
      process.exit(1)
    }
  },
} satisfies CommandDefinition

function selectGraphsToPrune(
  graphs: GraphInfo[],
  opts: PruneOpts,
  managerGraphName: string,
): GraphInfo[] {
  return graphs.filter((g) => {
    if (g.name === managerGraphName && !opts.includeManager) return false
    if (g.status === 'orphaned') return true
    if (opts.all && g.status === 'in-use') return true
    if (opts.includeManager && g.status === 'manager') return true
    return false
  })
}
