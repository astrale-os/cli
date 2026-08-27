/**
 * workspace-watch.ts — keeps the domain registry in sync with the workspace while
 * the studio is running. A domain dropped in (or one whose config + Application
 * schema binding just became complete) is registered, booted, and announced over
 * SSE; one whose composition vanished is unregistered. It reuses
 * `scanWorkspace` (detection) + `bootDomain` (lifecycle), so there is no second
 * source of truth for "what is a domain" or "how a domain comes online".
 */
import chokidar from 'chokidar'
import { basename } from 'node:path'

import { invalidate } from './cache'
import { scanWorkspace } from './detect'
import { allDomains, isDomainDir, unregisterDomain } from './domain'
import { bootDomain } from './lifecycle'
import { broadcast } from './sse'

const IGNORED =
  /(^|[/\\])(node_modules|\.git|\.astrale|\.domain-studio|dist|\.dist|\.next|\.cache|\.turbo|\.vercel|coverage)([/\\]|$)/
// only these file changes can change the domain SET (vs. ordinary in-domain edits)
export const DOMAIN_SET_TRIGGER_FILES = new Set(['astrale.config.ts', 'application.ts'])
const AUTHORED_SOURCE = /\.[cm]?[jt]sx?$/u

/**
 * Watch `root` for domains appearing/disappearing.
 * @param stoppers shared `domainId → file-watcher stop` map. The startup scan seeds
 *   it (via bootDomain); this watcher keeps it in sync as domains come and go.
 */
export function watchWorkspace(root: string, stoppers: Map<string, () => void>): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let queued = false

  const reconcile = async () => {
    const previous = new Map(allDomains().map((domain) => [domain.id, domain]))
    const before = new Set(previous.keys())
    let refreshed = false

    // 1. drop domains whose Application composition vanished.
    for (const h of allDomains()) {
      if (isDomainDir(h.root)) continue
      stoppers.get(h.id)?.()
      stoppers.delete(h.id)
      unregisterDomain(h.id)
      console.log(`  Domain Studio — domain removed: ${h.id}`)
    }

    // 2. Register + boot new domains. If Application now selects another Schema
    //    module, replace the old per-domain watcher and invalidate its cached bundle.
    for (const h of scanWorkspace(root)) {
      const prior = previous.get(h.id)
      if (prior && prior !== h) {
        stoppers.get(h.id)?.()
        stoppers.delete(h.id)
        invalidate(h.id, 'all')
        refreshed = true
      }
      if (stoppers.has(h.id)) continue
      const { origin, stop } = await bootDomain(h)
      stoppers.set(h.id, stop)
      console.log(`  Domain Studio — domain added: ${origin} (${h.id})`)
    }

    // 3. announce if the set changed → clients refetch /api/workspace
    const after = new Set(allDomains().map((d) => d.id))
    if (refreshed || before.size !== after.size || [...after].some((id) => !before.has(id))) {
      broadcast({ type: 'workspace', domains: [...after] })
    }
  }

  // serialize reconciles — bootDomain is async; coalesce event bursts
  const run = async () => {
    if (running) {
      queued = true
      return
    }
    running = true
    try {
      await reconcile()
    } catch (e) {
      console.error('  Domain Studio — workspace reconcile failed:', e)
    } finally {
      running = false
      if (queued) {
        queued = false
        void run()
      }
    }
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void run(), 400)
  }
  const onCompositionChange = (p: string) => {
    if (DOMAIN_SET_TRIGGER_FILES.has(basename(p))) schedule()
  }
  const onSourceAddedOrRemoved = (p: string) => {
    if (DOMAIN_SET_TRIGGER_FILES.has(basename(p)) || AUTHORED_SOURCE.test(p)) schedule()
  }

  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    depth: 4,
    ignored: (p: string) => IGNORED.test(p),
  })
  watcher
    .on('addDir', schedule)
    .on('unlinkDir', schedule)
    .on('add', onSourceAddedOrRemoved)
    .on('unlink', onSourceAddedOrRemoved)
    .on('change', onCompositionChange)

  return () => {
    clearTimeout(timer)
    void watcher.close()
  }
}
