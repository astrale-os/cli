import { Command } from 'commander'

import { loadConfig } from '../lib/config'
import { log } from '../lib/logger'
import { compileSchema, watchSchema } from '../core/schema'
import { loadDistribution } from '../core/distribution'
import { bootDevKernel } from '../core/kernel'
import { startDevServer } from '../server/app'

interface DevOptions {
  watch: boolean
  clear: boolean
  port?: number
}

async function runDev(opts: DevOptions): Promise<void> {
  const config = await loadConfig()
  const wsPort = opts.port ?? config.wsPort

  compileSchema(config)

  const dist = await loadDistribution(config.entry)

  const session = await bootDevKernel({
    config,
    distribution: dist,
    clear: opts.clear,
  })

  const server = startDevServer(
    {
      kernel: session.kernel,
      graphAdapter: session.graphAdapter,
      distribution: dist.config,
      operationCount: session.operationCount,
    },
    wsPort,
  )

  log.blank()
  log.info('Dev kernel ready')
  log.blank()
  if (server.playgroundAvailable) {
    console.log(`  Playground:  http://localhost:${wsPort}`)
  }
  console.log(`  Kernel WS:   ws://localhost:${wsPort}/ws`)
  console.log(`  Graph:       ${config.graphName} (${config.host}:${config.port})`)
  log.blank()

  let stopWatcher: (() => void) | undefined
  if (opts.watch) {
    stopWatcher = watchSchema(config)
    console.log('  Watching for changes...')
    log.blank()
  }

  const shutdown = async () => {
    log.blank()
    log.info('Shutting down...')
    stopWatcher?.()
    server.stop()
    await session.shutdown()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

export const devCommand = new Command('dev')
  .description('Boot a local kernel with your distribution installed')
  .option('--no-watch', 'Disable file watching')
  .option('--clear', 'Clear graph before boot', false)
  .option('-p, --port <port>', 'WebSocket server port', parseInt)
  .action(async (opts) => {
    try {
      await runDev({
        watch: opts.watch,
        clear: opts.clear,
        port: opts.port,
      })
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })
