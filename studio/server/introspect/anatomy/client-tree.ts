import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { ClientTree } from '../../../shared/types'

import { listDirs, listFiles, readTextSafe } from './source'

// Client tree and best-effort top-level route registry parsing.
const RESERVED_CLIENT_DIRS = new Set(['shell', 'ui', 'views'])

export function buildClientTree(
  root: string,
  clientDir: string | null = join(root, 'client'),
): ClientTree {
  // Current SDK projects own presentation modules directly under ui/. Legacy
  // projects still point at a client package whose authored tree is client/src.
  const srcDir = clientDir
    ? join(clientDir, 'src')
    : existsSync(join(root, 'ui'))
      ? join(root, 'ui')
      : ''
  if (!existsSync(srcDir)) {
    return { shell: [], features: [], routes: {}, present: false }
  }

  const shell = listFiles(join(srcDir, 'shell'))

  const features = listDirs(srcDir)
    .filter((d) => !RESERVED_CLIENT_DIRS.has(d))
    .map((name) => ({ name, files: listFiles(join(srcDir, name)) }))

  const routes = parseRoutes(
    listFiles(srcDir)
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
      .map((file) => join(srcDir, file)),
  )

  return { shell, features, routes, present: true }
}

/**
 * Best-effort parse of top-level client route registries. Domains call these
 * maps ROUTES, VIEW_REGISTRY, or another local name; the stable contract is a
 * quoted `/ui/…` key pointing at a component identifier.
 */
function parseRoutes(files: string[]): Record<string, string> {
  const routes: Record<string, string> = {}
  for (const file of files) {
    const src = readTextSafe(file)
    const entryRe = /['"`](\/ui\/[^'"`]+)['"`]\s*:\s*([A-Za-z_$][\w$.]*)/g
    let match: RegExpExecArray | null
    while ((match = entryRe.exec(src)) !== null) {
      routes[match[1]] = match[2]
    }
  }
  return routes
}
