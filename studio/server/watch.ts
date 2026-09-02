/**
 * watch.ts — two debounced watch channels per domain:
 *   Application + selected Schema sources → re-introspect → schema-diff (+ compile-error)
 *   anatomy fileset   → anatomy-diff
 * The studio is read-only, so this only ever pushes; the client refetches.
 */
import chokidar, { type FSWatcher } from 'chokidar'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { DomainHandle } from './domain'

import { getBundle, invalidate, invalidateDatasets } from './cache'
import { broadcast } from './sse'
import { ANATOMY_GLOBS } from './state/baseline'

export const ANATOMY_PATHS = [...ANATOMY_GLOBS.files, ...ANATOMY_GLOBS.dirs]

// These paths can feed the ts-morph handler/source overlay. Their content is
// part of the schema bundle cache even though they are outside schema/ itself.
const BUNDLE_SOURCE_DIRS = new Set([
  'functions',
  'integrations',
  'mutations',
  'providers',
  'queries',
  'rules',
  'runtime',
  'utils',
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
  return (
    path === handle.applicationFile ||
    rel === 'runtime.ts' ||
    rel.endsWith('/runtime.ts') ||
    BUNDLE_SOURCE_DIRS.has(topLevel)
  )
}

/**
 * Domains take their watchers ONE AT A TIME.
 *
 * Attaching a domain's watchers walks its authored tree and registers a watch per
 * directory — hundreds, for a domain with a large `ui/` or `client/src`. A dozen
 * domains doing that at once held the event loop so completely that the studio's
 * port, open since before indexing, answered nothing for twenty seconds. Queued,
 * the same work leaves gaps the server can serve in.
 */
let attachQueue: Promise<void> = Promise.resolve()

function ready(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve) => {
    watcher.once('ready', () => resolve())
    watcher.once('error', () => resolve())
  })
}

export function watchDomain(handle: DomainHandle): () => void {
  let closed = false
  const open: FSWatcher[] = []

  const attach = async (): Promise<void> => {
    if (closed) return
    const schemaW = chokidar.watch([handle.applicationFile, handle.schemaDir], {
      ignoreInitial: true,
      ignored,
    })
    const anatomyW = chokidar.watch(
      ANATOMY_PATHS.map((p) => join(handle.root, p)),
      { ignoreInitial: true, ignored },
    )
    // Demo Datasets live under tests/ and are referenced from the configuration; neither is
    // part of the schema bundle, so they get their own channel and never trigger a rebuild.
    const testsDir = join(handle.root, 'tests')
    const datasetsW = chokidar.watch(
      [handle.configFile, ...(existsSync(testsDir) ? [testsDir] : [])],
      { ignoreInitial: true, ignored },
    )
    open.push(schemaW, anatomyW, datasetsW)
    listen(handle, schemaW, anatomyW, datasetsW)
    await Promise.all([ready(schemaW), ready(anatomyW), ready(datasetsW)])
    if (closed) for (const w of open) void w.close()
  }

  // `attach` on both settlements, then swallow: one domain's failure must neither
  // stall the queue nor surface as an unhandled rejection.
  attachQueue = attachQueue.then(attach, attach).catch(() => undefined)

  return () => {
    closed = true
    for (const w of open) void w.close()
  }
}

function listen(
  handle: DomainHandle,
  schemaW: FSWatcher,
  anatomyW: FSWatcher,
  datasetsW: FSWatcher,
): void {
  let st: ReturnType<typeof setTimeout> | undefined
  let at: ReturnType<typeof setTimeout> | undefined
  let dt: ReturnType<typeof setTimeout> | undefined

  datasetsW.on('all', () => {
    clearTimeout(dt)
    dt = setTimeout(() => {
      invalidateDatasets(handle.id)
      broadcast({ type: 'datasets', domainId: handle.id })
    }, 150)
  })

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
}
