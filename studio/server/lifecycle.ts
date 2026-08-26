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
import { initDotDir } from './state/store'
import { watchDomain } from './watch'

export interface BootedDomain {
  origin: string
  depsInstalled: boolean
  /** stops the domain's file watcher */
  stop: () => void
}

/** Initialize + start watching one domain. Returns its origin + a stop handle. */
export async function bootDomain(handle: DomainHandle): Promise<BootedDomain> {
  initDotDir(handle.root)
  const bundle = await getBundle(handle.id)
  if (!loadBaseline(handle.root))
    captureBaseline(
      handle.root,
      {
        ir: bundle?.ir ?? null,
        root: bundle?.schemaMode === 'canonical-admitted' ? (bundle.schemaRoot ?? null) : null,
        revision: bundle?.schemaRevision ?? null,
      },
      hashAnatomyFiles(handle.root, handle.schemaDirName),
    )
  const stop = watchDomain(handle)
  return {
    origin: bundle?.ir?.domain ?? handle.origin ?? handle.id,
    depsInstalled: !!bundle?.depsInstalled,
    stop,
  }
}
