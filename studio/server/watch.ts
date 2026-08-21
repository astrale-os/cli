/**
 * watch.ts — two debounced watch channels per domain:
 *   schema/**         → re-introspect → schema-diff (+ compile-error)
 *   anatomy fileset   → anatomy-diff
 * The studio is read-only, so this only ever pushes; the client refetches.
 */
import chokidar from 'chokidar'
import { join, relative } from 'node:path'

import type { DomainHandle } from './domain'

import { getBundle, invalidate } from './cache'
import { broadcast } from './sse'
import { ANATOMY_GLOBS } from './state/baseline'

export const ANATOMY_PATHS = [...ANATOMY_GLOBS.files, ...ANATOMY_GLOBS.dirs]

// These paths can feed the ts-morph handler/source overlay. Their content is
// part of the schema bundle cache even though they are outside schema/ itself.
const BUNDLE_SOURCE_DIRS = new Set([
  'actions',
  'capabilities',
  'functions',
  'handlers',
  'mutations',
  'queries',
  'rules',
  'runtime',
  'utils',
  'workflows',
])

function ignored(p: string): boolean {
  return (
    p.includes('node_modules') ||
    p.includes('.domain-studio') ||
    p.includes('.astrale') ||
    p.includes('.dist')
  )
}

export function affectsBundle(handle: DomainHandle, path: string): boolean {
  const rel = relative(handle.root, path).split('\\').join('/')
  const topLevel = rel.split('/')[0]
  return rel === 'implementation.ts' || rel === 'domain.ts' || BUNDLE_SOURCE_DIRS.has(topLevel)
}

export function watchDomain(handle: DomainHandle): () => void {
  const schemaW = chokidar.watch(handle.schemaDir, { ignoreInitial: true, ignored })
  const anatomyW = chokidar.watch(
    ANATOMY_PATHS.map((p) => join(handle.root, p)),
    { ignoreInitial: true, ignored },
  )

  let st: ReturnType<typeof setTimeout> | undefined
  let at: ReturnType<typeof setTimeout> | undefined

  schemaW.on('all', () => {
    clearTimeout(st)
    st = setTimeout(async () => {
      // Origin and View declarations are part of the current schema, so schema
      // edits invalidate both render surfaces.
      invalidate(handle.id, 'all')
      broadcast({ type: 'resolving', domainId: handle.id })
      const b = await getBundle(handle.id, true)
      if (b?.error)
        broadcast({ type: 'compile-error', domainId: handle.id, message: b.error.message })
      broadcast({
        type: 'schema-diff',
        domainId: handle.id,
        renderFingerprint: b?.renderFingerprint ?? 'sha-none',
      })
      broadcast({ type: 'anatomy-diff', domainId: handle.id })
    }, 150)
  })

  anatomyW.on('all', (_event, path) => {
    clearTimeout(at)
    at = setTimeout(() => {
      invalidate(handle.id, affectsBundle(handle, path) ? 'all' : 'anatomy')
      broadcast({ type: 'anatomy-diff', domainId: handle.id })
    }, 150)
  })

  return () => {
    schemaW.close()
    anatomyW.close()
  }
}
