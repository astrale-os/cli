import { Command } from 'commander'

import { loadConfig } from '../lib/config'
import { runCodegen } from '../lib/codegen'
import { log } from '../lib/logger'
import { compileSchema, watchSchema } from '../core/schema'

async function runGenerate(opts: { scaffold: boolean; check: boolean }): Promise<void> {
  const config = await loadConfig()

  if (opts.check) {
    runCodegen({
      schemaPath: config.schema,
      outputDir: config.outputDir,
      check: true,
    })
    log.success('Generated files are up-to-date')
    return
  }

  const result = runCodegen({
    schemaPath: config.schema,
    outputDir: config.outputDir,
    scaffold: opts.scaffold,
  })

  log.success(
    `Schema compiled (${result.nodeCount} nodes, ${result.edgeCount} edges, ${result.methodCount} methods)`,
  )
  if (result.scaffoldWritten) {
    log.success('Method scaffold written to src/methods.ts')
  }
}

async function runGenerateWatch(): Promise<void> {
  const config = await loadConfig()

  // Initial compile
  compileSchema(config)

  log.info(`Watching ${config.schema} for changes...`)
  watchSchema(config)
}

export const generateCommand = new Command('generate')
  .description('Compile .gsl schema to TypeScript types')
  .option('--scaffold', 'Write method scaffold (skips if exists)', false)
  .option('--check', 'Verify generated files are up-to-date', false)
  .option('-w, --watch', 'Watch for .gsl changes and recompile', false)
  .action(async (opts) => {
    try {
      if (opts.watch) {
        await runGenerateWatch()
      } else {
        await runGenerate({ scaffold: opts.scaffold, check: opts.check })
      }
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })
