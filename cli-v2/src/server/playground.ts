import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { log } from '../lib/logger'

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

/**
 * Resolve the built playground dist directory, or undefined if not available.
 */
export function resolvePlaygroundDir(): string | undefined {
  try {
    const pkgPath = require.resolve('@astrale-os/kernel-playground/package.json')
    const distDir = join(dirname(pkgPath), 'dist')
    if (existsSync(join(distDir, 'index.html'))) {
      return distDir
    }
    log.warn('Playground not built — run: pnpm --filter @astrale-os/kernel-playground build')
    return undefined
  } catch {
    return undefined
  }
}
