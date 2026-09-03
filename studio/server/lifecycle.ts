import type { DomainHandle } from './domain'

/**
 * lifecycle.ts — bring a single domain online: prepare its `.domain-studio` dir,
 * warm its bundle, seed the baseline, and start watching its files. Used by BOTH
 * the startup scan (index.ts) and the live workspace watcher (workspace-watch.ts),
 * so a domain added while the studio is running boots in exactly the same way as
 * one present at launch.
 */
import { getBundle } from './cache'
import { captureBaseline, hashAnatomyFiles, loadBaseline } from './state/baseline'
import { migrateDocuments } from './state/documents'
import { initDotDir, removeState } from './state/store'
import { watchDomain } from './watch'

export interface BootedDomain {
  origin: string
  depsInstalled: boolean
  /** identifies the render this boot produced, so clients can be told it landed */
  renderFingerprint: string
  /** stops the domain's file watcher */
  stop: () => void
}

/** Initialize + start watching one domain. Returns its origin + a stop handle. */
export async function bootDomain(
  handle: DomainHandle,
  /** Startup indexing: yields the thread to anyone actually reading. */
  options: { background?: boolean } = {},
): Promise<BootedDomain> {
  initDotDir(handle.root)
  // one-shot: uuid-named documents become readable file names under context/docs
  migrateDocuments(handle.root)
  // Chats, transcripts and bridge grants moved to the studio's home on this machine:
  // whatever an earlier studio left here is cache, and stale cache at that.
  try {
    removeState(handle.root, '.cache/agent')
  } catch {
    /* best-effort */
  }
  const bundle = await getBundle(
    handle.id,
    false,
    options.background === true ? 'background' : 'reader',
  )
  if (!loadBaseline(handle.root))
    captureBaseline(
      handle.root,
      {
        ir: bundle?.ir ?? null,
        root: bundle?.schemaMode === 'canonical-admitted' ? (bundle.schemaRoot ?? null) : null,
        revision: bundle?.schemaRevision ?? null,
      },
      hashAnatomyFiles(handle.root, handle.schemaDirName, handle.applicationFile),
    )
  const stop = watchDomain(handle)
  return {
    origin: bundle?.ir?.domain ?? handle.origin ?? handle.id,
    depsInstalled: !!bundle?.depsInstalled,
    renderFingerprint: bundle?.renderFingerprint ?? 'sha-none',
    stop,
  }
}
