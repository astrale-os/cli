/**
 * workspace-watch.ts — keeps the domain registry in sync with the workspace while
 * the studio is running. A domain dropped in (or one whose astrale.config.ts +
 * domain.ts + schema/index.ts triple just completed) is registered, booted, and
 * announced over SSE; one whose triple vanished is unregistered. It reuses
 * `scanWorkspace` (detection) + `bootDomain` (lifecycle), so there is no second
 * source of truth for "what is a domain" or "how a domain comes online".
 */
import chokidar from 'chokidar'
import { basename } from 'node:path'

import { scanWorkspace } from './detect'
import { allDomains, isDomainDir, unregisterDomain } from './domain'
import { bootDomain } from './lifecycle'
import { broadcast } from './sse'

const IGNORED =
  /(^|[/\\])(node_modules|\.git|\.astrale|\.domain-studio|dist|\.dist|\.next|\.cache|\.turbo|\.vercel|coverage)([/\\]|$)/
// only these file changes can change the domain SET (vs. ordinary in-domain edits)
const TRIGGERS = new Set(['astrale.config.ts', 'domain.ts', 'index.ts'])

/**
 * Watch `root` for domains appearing/disappearing.
 * @param stoppers shared `domainId → file-watcher stop` map. The startup scan seeds
 *   it (via bootDomain); this watcher keeps it in sync as domains come and go.
 */
export function watchWorkspace(
  root: string,
  schemaDirName: string,
  stoppers: Map<string, () => void>,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let queued = false

  const reconcile = async () => {
    const before = new Set(allDomains().map((d) => d.id))

    // 1. drop domains whose triple vanished (dir deleted, or a trigger file removed)
    for (const h of allDomains()) {
      if (isDomainDir(h.root, h.schemaDirName)) continue
      stoppers.get(h.id)?.()
      stoppers.delete(h.id)
      unregisterDomain(h.id)
      console.log(`  Domain Studio — domain removed: ${h.id}`)
    }

    // 2. register + boot any new ones (scanWorkspace registers; bootDomain initializes + watches)
    for (const h of scanWorkspace(root, schemaDirName)) {
      if (stoppers.has(h.id)) continue
      const { origin, stop } = await bootDomain(h)
      stoppers.set(h.id, stop)
      console.log(`  Domain Studio — domain added: ${origin} (${h.id})`)
    }

    // 3. announce if the set changed → clients refetch /api/workspace
    const after = new Set(allDomains().map((d) => d.id))
    if (before.size !== after.size || [...after].some((id) => !before.has(id))) {
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
  const onFile = (p: string) => {
    if (TRIGGERS.has(basename(p))) schedule()
  }

  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    depth: 4,
    ignored: (p: string) => IGNORED.test(p),
  })
  watcher.on('addDir', schedule).on('unlinkDir', schedule).on('add', onFile).on('unlink', onFile)

  return () => {
    clearTimeout(timer)
    void watcher.close()
  }
}
