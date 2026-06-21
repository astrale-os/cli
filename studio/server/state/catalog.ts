/**
 * catalog.ts — the domain catalog for the canvas "Import a domain" picker. It merges:
 *   - the kernel (always present + required),
 *   - the LOCAL domains detected in this workspace,
 *   - a curated set of FAKED external service domains (placeholders until a real
 *     registry exists).
 * Each entry carries a lucide-style SVG icon + a one-line description.
 */
import type { DomainCatalogEntry } from '../../shared/types'

const icon = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`

const HEXAGON = icon(
  '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m7.5 4.27 9 5.15"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
)
const BOXES = icon(
  '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/>',
)
const BELL = icon(
  '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
)
const CARD = icon(
  '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
)
const USERS = icon(
  '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
)
const CHART = icon(
  '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
)
const SEARCH = icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>')
const DRIVE = icon(
  '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
)
const SPARKLES = icon(
  '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
)

const KERNEL: DomainCatalogEntry = {
  origin: 'kernel.astrale.ai',
  name: 'Kernel',
  kind: 'kernel',
  description: 'The typed graph every domain is built on.',
  icon: HEXAGON,
  required: true,
}

const EXTERNAL: DomainCatalogEntry[] = [
  {
    origin: 'notifications.astrale.ai',
    name: 'Notifications',
    kind: 'external',
    description: 'Email, push & SMS delivery.',
    icon: BELL,
  },
  {
    origin: 'payments.astrale.ai',
    name: 'Payments',
    kind: 'external',
    description: 'Charges, subscriptions & invoices.',
    icon: CARD,
  },
  {
    origin: 'identity.astrale.ai',
    name: 'Identity',
    kind: 'external',
    description: 'SSO, directory sync & users.',
    icon: USERS,
  },
  {
    origin: 'analytics.astrale.ai',
    name: 'Analytics',
    kind: 'external',
    description: 'Events, funnels & dashboards.',
    icon: CHART,
  },
  {
    origin: 'search.astrale.ai',
    name: 'Search',
    kind: 'external',
    description: 'Full-text & vector search.',
    icon: SEARCH,
  },
  {
    origin: 'storage.astrale.ai',
    name: 'Storage',
    kind: 'external',
    description: 'Files, blobs & a CDN.',
    icon: DRIVE,
  },
  {
    origin: 'ai.astrale.ai',
    name: 'AI Gateway',
    kind: 'external',
    description: 'LLM routing & embeddings.',
    icon: SPARKLES,
  },
]

function humanize(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

export function buildCatalog(locals: { origin: string; id: string }[]): DomainCatalogEntry[] {
  const localEntries: DomainCatalogEntry[] = locals.map((d) => ({
    origin: d.origin,
    name: humanize(d.id),
    kind: 'local',
    description: 'A domain in this workspace.',
    icon: BOXES,
  }))
  return [KERNEL, ...localEntries, ...EXTERNAL]
}
