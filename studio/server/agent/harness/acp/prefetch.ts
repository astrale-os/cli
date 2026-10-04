/**
 * prefetch.ts — install a release's pinned agent builds before Studio needs them.
 *
 * Each Astrale release pins its own Claude Code and Codex, so a release cannot
 * fetch the next one's: the NEW binary has to. `astrale update` therefore starts
 * it detached (`__studio-agents-prefetch`) right after replacing the old one,
 * and the first chat after an update finds its agent already there instead of
 * waiting on ~100 MB.
 *
 * Only agents this machine already ran through Studio are fetched — a CLI that
 * never opened Studio, or only ever used Claude, downloads nothing it would not.
 * Failures are left to the next real use, which retries and reports them.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { AcpProvider } from './command'

import {
  agentBinary,
  agentBinaryRoot,
  ensureAgentBinary,
  pruneAgentBinaries,
  type AgentBinary,
} from './binary'

const PROVIDERS: readonly AcpProvider[] = ['claude', 'codex']

export interface PrefetchDependencies {
  ensure: (binary: AgentBinary) => Promise<void>
  prune: (provider: AcpProvider, root: string) => Promise<void>
}

const DEPENDENCIES: PrefetchDependencies = {
  ensure: (binary) => ensureAgentBinary(binary),
  prune: (provider, root) => pruneAgentBinaries(provider, root),
}

/** Fetch this release's build of every agent Studio already ran here; returns those fetched. */
export async function prefetchAgentBinaries(
  root = agentBinaryRoot(),
  dependencies: PrefetchDependencies = DEPENDENCIES,
): Promise<AcpProvider[]> {
  const fetched: AcpProvider[] = []
  for (const provider of PROVIDERS) {
    if (!existsSync(join(root, provider))) continue
    try {
      await dependencies.ensure(agentBinary(provider, undefined, undefined, root))
      fetched.push(provider)
    } catch {
      // the next turn retries, and says why if it still cannot
    }
    await dependencies.prune(provider, root).catch(() => undefined)
  }
  return fetched
}
