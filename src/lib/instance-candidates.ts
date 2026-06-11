import type { InstanceEntry, InstanceStore } from './instance'

import { formatInstanceLocation, type InstanceInfo } from './admin-instance'
import { normalizeInstanceKernelUrl, resolveInstanceKey } from './instance'

export type InstanceCandidate =
  | { source: 'bookmark'; key: string; url: string; entry: InstanceEntry }
  | { source: 'managed'; key: string; url: string; info: InstanceInfo }

/**
 * Gather every instance a bare name can refer to — the local bookmark
 * (collision-guarded, so at most one) plus admin-managed instances matching
 * the slug. A managed instance already bookmarked at the same kernel URL
 * collapses into the bookmark candidate instead of appearing twice.
 */
export function collectInstanceCandidates(
  name: string,
  store: InstanceStore,
  managed: InstanceInfo[],
): InstanceCandidate[] {
  const out: InstanceCandidate[] = []

  const key = resolveInstanceKey(store, name)
  const entry = key ? store.instances[key] : undefined
  const bookmarkUrl = entry?.url ? normalizeInstanceKernelUrl(entry.url) : null
  if (key && entry && bookmarkUrl) {
    out.push({ source: 'bookmark', key, url: bookmarkUrl, entry })
  }

  for (const info of managed) {
    if (info.slug !== name && info.id !== name) continue
    // The type says url is set, but a still-provisioning instance can
    // come back without one — not a usable target.
    if (!info.url) continue
    const url = normalizeInstanceKernelUrl(info.url)
    if (bookmarkUrl && url === bookmarkUrl) continue
    out.push({ source: 'managed', key: info.slug, url, info })
  }

  return out
}

export function describeInstanceCandidate(candidate: InstanceCandidate): string {
  if (candidate.source === 'bookmark') {
    return `${candidate.key} (bookmark) ${candidate.url}`
  }
  const extra = formatInstanceLocation(candidate.info)
  return `${candidate.key} (managed) ${candidate.url}${extra ? ` — ${extra}` : ''}`
}
