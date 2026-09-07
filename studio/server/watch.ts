/**
 * watch.ts — two debounced watch channels per domain:
 *   Application + selected Schema sources → re-introspect → schema-diff (+ compile-error)
 *   anatomy fileset   → anatomy-diff
 * The studio is read-only, so this only ever pushes; the client refetches.
 */
import chokidar, { type FSWatcher as ChokidarWatcher } from 'chokidar'
import { existsSync, watch as watchFs } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

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

export interface DomainWatchChannels {
  schema: boolean
  anatomy: boolean
  datasets: boolean
}

const inside = (path: string, root: string): boolean =>
  root === '.' || path === root || path.startsWith(`${root}/`)

/** Route one native recursive-watch event to the same three channels as Chokidar. */
export function domainWatchChannels(handle: DomainHandle, path: string): DomainWatchChannels {
  const absolute = resolve(path)
  const rel = relative(handle.root, absolute).split('\\').join('/')
  if (!rel || rel === '..' || rel.startsWith('../')) {
    return { schema: false, anatomy: false, datasets: false }
  }
  return {
    schema: absolute === resolve(handle.applicationFile) || inside(rel, handle.schemaDirName),
    anatomy: ANATOMY_PATHS.some((candidate) => inside(rel, candidate)),
    datasets:
      absolute === resolve(handle.configFile) || rel === 'tests' || rel.startsWith('tests/'),
  }
}

interface DomainWatchHandlers {
  schema(): void
  anatomy(path: string): void
  datasets(): void
}

function domainWatchHandlers(handle: DomainHandle): DomainWatchHandlers {
  let schemaTimer: ReturnType<typeof setTimeout> | undefined
  let anatomyTimer: ReturnType<typeof setTimeout> | undefined
  let datasetsTimer: ReturnType<typeof setTimeout> | undefined
  return {
    datasets: () => {
      clearTimeout(datasetsTimer)
      datasetsTimer = setTimeout(() => {
        invalidateDatasets(handle.id)
        broadcast({ type: 'datasets', domainId: handle.id })
      }, 150)
    },
    schema: () => {
      clearTimeout(schemaTimer)
      schemaTimer = setTimeout(async () => {
        // Origin and View declarations are part of the current schema, so schema
        // edits invalidate both render surfaces.
        invalidate(handle.id, 'all')
        broadcast({ type: 'resolving', domainId: handle.id })
        const bundle = await getBundle(handle.id, true)
        if (bundle?.error)
          broadcast({ type: 'compile-error', domainId: handle.id, message: bundle.error.message })
        broadcast({
          type: 'schema-diff',
          domainId: handle.id,
          renderFingerprint: bundle?.renderFingerprint ?? 'sha-none',
        })
        broadcast({ type: 'anatomy-diff', domainId: handle.id })
      }, 150)
    },
    anatomy: (path) => {
      clearTimeout(anatomyTimer)
      anatomyTimer = setTimeout(() => {
        invalidate(handle.id, affectsBundle(handle, path) ? 'all' : 'anatomy')
        broadcast({ type: 'anatomy-diff', domainId: handle.id })
      }, 150)
    },
  }
}

/**
 * Chokidar fallback domains take their watchers ONE AT A TIME.
 *
 * Attaching a domain's watchers walks its authored tree and registers a watch per
 * directory — hundreds, for a domain with a large `ui/` or `client/src`. A dozen
 * domains doing that at once held the event loop so completely that the studio's
 * port, open since before indexing, answered nothing for twenty seconds. Queued,
 * the same work leaves gaps the server can serve in.
 */
let attachQueue: Promise<void> = Promise.resolve()

function ready(watcher: ChokidarWatcher): Promise<void> {
  return new Promise((resolve) => {
    watcher.once('ready', () => resolve())
    watcher.once('error', () => resolve())
  })
}

export function watchDomain(handle: DomainHandle): () => void {
  const started = performance.now()
  const handlers = domainWatchHandlers(handle)

  // Bun/modern Node expose the OS recursive watcher on macOS, Windows and Linux.
  // It subscribes without crawling every authored directory first — the crawl is
  // what made a large Domain stop the HTTP loop for tens of seconds. Keep the
  // Chokidar path below for filesystems/runtimes that reject recursive watching.
  try {
    const watcher = watchFs(handle.root, { recursive: true }, (_event, filename) => {
      if (filename === null) {
        handlers.schema()
        handlers.anatomy(handle.root)
        handlers.datasets()
        return
      }
      const name = String(filename)
      const path = isAbsolute(name) ? name : join(handle.root, name)
      if (ignored(path)) return
      const channels = domainWatchChannels(handle, path)
      if (channels.schema) handlers.schema()
      if (channels.anatomy) handlers.anatomy(path)
      if (channels.datasets) handlers.datasets()
    })
    watcher.on('error', (error) =>
      console.error(`  Domain Studio — native watcher failed for ${handle.id}:`, error),
    )
    if (process.env.DOMAIN_STUDIO_TIMINGS === '1') {
      console.log(
        `    timing watcher ${handle.id} native=${Math.round((performance.now() - started) * 10) / 10}ms`,
      )
    }
    return () => watcher.close()
  } catch {
    // Recursive watching is not available on every filesystem/runtime. Its
    // portable fallback retains the existing event semantics.
  }

  let closed = false
  const open: ChokidarWatcher[] = []

  const attach = async (): Promise<void> => {
    if (closed) return
    const fallbackStarted = performance.now()
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
    listen(handlers, schemaW, anatomyW, datasetsW)
    await Promise.all([ready(schemaW), ready(anatomyW), ready(datasetsW)])
    if (process.env.DOMAIN_STUDIO_TIMINGS === '1') {
      console.log(
        `    timing watcher ${handle.id} fallback=${Math.round((performance.now() - fallbackStarted) * 10) / 10}ms`,
      )
    }
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
  handlers: DomainWatchHandlers,
  schemaW: ChokidarWatcher,
  anatomyW: ChokidarWatcher,
  datasetsW: ChokidarWatcher,
): void {
  datasetsW.on('all', handlers.datasets)
  schemaW.on('all', handlers.schema)
  anatomyW.on('all', (_event, path) => handlers.anatomy(path))
}
