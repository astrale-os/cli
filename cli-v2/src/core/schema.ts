import { watch } from 'node:fs'
import { resolve, dirname } from 'node:path'

import { runCodegen, type CodegenResult } from '../lib/codegen'
import { log } from '../lib/logger'
import type { ResolvedConfig } from '../lib/config'

/**
 * Compile the GSL schema. Logs progress and lets errors propagate.
 */
export function compileSchema(config: ResolvedConfig): CodegenResult {
  log.info('Compiling schema...')
  const result = runCodegen({
    schemaPath: config.schema,
    outputDir: config.outputDir,
  })
  log.success(
    `Schema compiled (${result.nodeCount} nodes, ${result.edgeCount} edges, ${result.methodCount} methods)`,
  )
  return result
}

/**
 * Watch the schema directory for .gsl file changes.
 * Recompiles on change with a 150ms debounce.
 * Returns a cleanup function to stop watching.
 */
export function watchSchema(config: ResolvedConfig): () => void {
  const schemaPath = resolve(config.schema)
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  try {
    const watcher = watch(dirname(schemaPath), (_event, filename) => {
      if (!filename || !filename.endsWith('.gsl')) return

      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        log.info('Schema changed — recompiling...')
        try {
          const result = runCodegen({
            schemaPath: config.schema,
            outputDir: config.outputDir,
          })
          log.success(
            `Schema compiled (${result.nodeCount} nodes, ${result.edgeCount} edges, ${result.methodCount} methods)`,
          )
          log.warn('Restart dev server to apply schema changes (Ctrl+C, then astrale dev)')
        } catch (err) {
          log.error('Schema compilation failed:', err instanceof Error ? err.message : String(err))
        }
      }, 150)
    })
    return () => watcher.close()
  } catch {
    return () => {} // directory may not exist yet
  }
}
