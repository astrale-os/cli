/**
 * workspace-watch.ts — keeps the domain registry in sync with the workspace while
 * the studio is running. A domain dropped in (or one whose config + Application
 * schema binding just became complete) is registered, booted, and announced over
 * SSE; one whose composition vanished is unregistered. It reuses
 * `scanWorkspace` (detection) + `bootDomain` (lifecycle), so there is no second
 * source of truth for "what is a domain" or "how a domain comes online".
 *
 * It RE-SCANS on a timer rather than watching the tree. Watching meant a recursive
 * chokidar over the whole workspace: on a real monorepo that is four thousand
 * directory watchers, and registering them starved the event loop for a minute and
 * a half — the studio's port was open that whole time and answered nothing. A scan
 * is the same walk detection already does at boot, costs about a tenth of a second,
 * and the thing it is watching for — a domain appearing on disk from somewhere
 * other than Studio — is rare and in no hurry. `create new` never waits on this: it
 * registers and boots the domain it just scaffolded itself (see workspace/create).
 */
import { invalidate } from './cache'
import { scanWorkspace } from './detect'
import { allDomains, isDomainDir, unregisterDomain } from './domain'
import { bootDomain } from './lifecycle'
import { broadcast } from './sse'

/** How often the workspace is re-read for domains that appeared or vanished. */
export const WORKSPACE_RESCAN_MS = 15_000

/**
 * Watch `root` for domains appearing/disappearing.
 * @param stoppers shared `domainId → file-watcher stop` map. The startup scan seeds
 *   it (via bootDomain); this watcher keeps it in sync as domains come and go.
 */
export function watchWorkspace(
  root: string,
  stoppers: Map<string, () => void>,
  intervalMs = WORKSPACE_RESCAN_MS,
): () => void {
  let running = false

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

  // Never overlap: a reconcile boots domains, which is async and can outlast a tick.
  const run = async () => {
    if (running) return
    running = true
    try {
      await reconcile()
    } catch (e) {
      console.error('  Domain Studio — workspace reconcile failed:', e)
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void run(), intervalMs)
  timer.unref?.() // a periodic scan must never be the reason the process stays alive
  return () => clearInterval(timer)
}
