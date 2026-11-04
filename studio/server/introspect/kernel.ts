/**
 * The read-only Kernel Domain. Studio has no Kernel project on disk: it reads the Kernel
 * Schema that a workspace Domain's installed SDK ships, through the same extractor island
 * and the same canonical projection as an authored Domain. The Kernel shown is therefore
 * the exact one that Domain is built against.
 */
import { resolve } from 'node:path'

import type { DomainAnatomy, StudioSchemaBundle } from '../../shared/contracts/schema'

import { KERNEL_DOMAIN_ID, KERNEL_ORIGIN } from '../../shared/contracts/workspace'
import { allDomains, depsInstalled } from '../domain/registry'
import { studioSettings } from '../state/settings'
import { renderFingerprintOf } from './hash'
import { runtimeExtract } from './runtime'
import { introspectionScheduler } from './scheduler'

/** A project able to supply the Kernel Schema: the root its SDK is installed under. */
interface KernelSource {
  readonly root: string
}

/** Studio's own checkout, used only when no workspace Domain has its dependencies installed. */
const STUDIO_ROOT = resolve(import.meta.dir, '..', '..')

const bundles = new Map<string, Promise<StudioSchemaBundle>>()

/** The workspace Domain whose SDK supplies the Kernel: the first one, by id, with deps installed. */
function kernelSource(): KernelSource {
  const domain = allDomains()
    .filter((handle) => depsInstalled(handle.root))
    .sort((left, right) => left.id.localeCompare(right.id))[0]
  return { root: domain?.root ?? STUDIO_ROOT }
}

export function getKernelBundle(): Promise<StudioSchemaBundle> {
  const source = kernelSource()
  const cached = bundles.get(source.root)
  if (cached) return cached
  const built = introspectionScheduler
    .schedule('kernel', 'reader', () => buildKernelBundle(source))
    .promise.catch((error: unknown) => {
      bundles.delete(source.root)
      throw error
    })
  bundles.set(source.root, built)
  return built
}

/** Forget the extracted Kernel, so the next read takes the current workspace SDK. */
export function invalidateKernel(): void {
  bundles.clear()
}

async function buildKernelBundle(source: KernelSource): Promise<StudioSchemaBundle> {
  if (!depsInstalled(source.root)) {
    return unavailableBundle(
      'install the dependencies of a Domain (`pnpm install`) so Studio can read the Kernel its SDK ships.',
    )
  }
  const result = await runtimeExtract('--kernel', source.root, studioSettings().introspectTimeoutMs)
  if (!result.ok) return unavailableBundle(result.error?.message ?? 'extraction failed')
  const ir = result.ir
  return {
    domainId: KERNEL_DOMAIN_ID,
    renderFingerprint: renderFingerprintOf(result.root ?? ir),
    schemaMode: result.schemaMode,
    ...(result.revision === null ? {} : { schemaRevision: result.revision }),
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir,
    ...(result.root === null ? {} : { schemaRoot: result.root }),
    // The Kernel has no authored sources here: no handler links, no source spans.
    overlay: { handlerLinks: [], sourceSpans: {} },
    error: null,
    extractedAt: new Date().toISOString(),
  }
}

function unavailableBundle(reason: string): StudioSchemaBundle {
  return {
    domainId: KERNEL_DOMAIN_ID,
    renderFingerprint: renderFingerprintOf({ kernel: 'unavailable', reason }),
    schemaMode: 'unavailable',
    extractedBy: 'runtime-bun',
    depsInstalled: false,
    ir: null,
    overlay: { handlerLinks: [], sourceSpans: {} },
    error: { message: `Kernel Schema unavailable: ${reason}` },
    extractedAt: new Date().toISOString(),
  }
}

/** The Kernel has no project: no Views, client, env, or integrations to read. */
export function kernelAnatomy(): DomainAnatomy {
  return {
    overview: {
      origin: KERNEL_ORIGIN,
      adapter: 'unknown',
      requires: [],
      astraleDeps: {},
      schemaDir: '',
    },
    views: [],
    client: { shell: [], features: [], routes: {}, present: false },
    env: [],
    detectedIntegrations: [],
  }
}
