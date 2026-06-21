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

const ANATOMY = [
  'domain.ts',
  'core.ts',
  'core',
  'runtime',
  'views',
  'functions',
  'client/src',
  'deps.ts',
  'env.ts',
  'package.json',
  'astrale.config.ts',
]

function ignored(p: string): boolean {
  return (
    p.includes('node_modules') ||
    p.includes('.domain-studio') ||
    p.includes('.astrale') ||
    p.includes('.dist')
  )
}

function affectsBundle(handle: DomainHandle, path: string): boolean {
  const rel = relative(handle.root, path).split('\\').join('/')
  return rel === 'domain.ts' || rel === 'runtime' || rel.startsWith('runtime/')
}

export function watchDomain(handle: DomainHandle): () => void {
  const schemaW = chokidar.watch(handle.schemaDir, { ignoreInitial: true, ignored })
  const anatomyW = chokidar.watch(
    ANATOMY.map((p) => join(handle.root, p)),
    { ignoreInitial: true, ignored },
  )

  let st: ReturnType<typeof setTimeout> | undefined
  let at: ReturnType<typeof setTimeout> | undefined

  schemaW.on('all', () => {
    clearTimeout(st)
    st = setTimeout(async () => {
      invalidate(handle.id, 'schema')
      broadcast({ type: 'resolving', domainId: handle.id })
      const b = await getBundle(handle.id, true)
      if (b?.error)
        broadcast({ type: 'compile-error', domainId: handle.id, message: b.error.message })
      broadcast({
        type: 'schema-diff',
        domainId: handle.id,
        schemaHash: b?.schemaHash ?? 'sha-none',
      })
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
