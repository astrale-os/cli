import type { KernelClient } from '@astrale-os/shell'

export type ViewMode = 'relations' | 'permissions' | 'inheritance'

export type HighlightInfo =
  | { mode: 'relations'; kind: string }
  | { mode: 'permissions'; source: 'direct' | 'union' }
  | { mode: 'inheritance'; depth: number }

export type BadgeInfo = HighlightInfo

export type Edge = {
  class: string
  source: string
  target: string
  slug?: string | null
  props?: Record<string, unknown>
}

export type ComputedView = {
  mode: ViewMode
  pinnedNodeId: string
  pinnedPath: string
  highlightMap: Map<string, HighlightInfo>
  availableEdgeKinds?: string[]
  selectedEdgeKinds?: Set<string>
  edgeCache?: Edge[]
}

const KERNEL_DOMAIN = 'kernel.astrale.ai'
const HAS_PARENT_KIND = 'has_parent'
const EXTENDS_WITH_CLASS = `/:${KERNEL_DOMAIN}:class.extends_with`
const HAS_PERM_CLASS = `/:${KERNEL_DOMAIN}:class.has_perm`
const EXTENDS_CLASS = `/:${KERNEL_DOMAIN}:class.extends`
const IMPLEMENTS_CLASS = `/:${KERNEL_DOMAIN}:class.implements`

const MAX_BFS_DEPTH = 16

export function shortKindFromClass(classPath: string): string {
  const marker = ':class.'
  const i = classPath.lastIndexOf(marker)
  return i >= 0 ? classPath.slice(i + marker.length) : classPath
}

// ─── color mapping ──────────────────────────────────────────────────────────
//
// Each edge kind gets a distinct palette. Colors are picked for pleasant
// contrast against a neutral bg with ~10% opacity tint, plus a stronger
// left-border accent. Permissions get two hues (direct vs inherited via
// extends_with union); inheritance fades a single hue by depth.

const EDGE_PALETTE: Record<string, string> = {
  extends: 'sky',
  implements: 'indigo',
  has_perm: 'emerald',
  extends_with: 'violet',
  method_of: 'amber',
  instance_of: 'teal',
  of_domain: 'rose',
  calls: 'pink',
  installed_in: 'orange',
  has_desktop: 'cyan',
  home_of: 'lime',
  view_for: 'fuchsia',
  from: 'yellow',
  to: 'yellow',
}

function paletteFor(h: HighlightInfo): string {
  if (h.mode === 'relations') return EDGE_PALETTE[h.kind] ?? 'slate'
  if (h.mode === 'permissions') return h.source === 'direct' ? 'emerald' : 'violet'
  return 'sky'
}

// Static class map — Tailwind v4 scans these literals at build time.
type ClassSet = { row: string; dot: string; swatch: string }
const CLASS_MAP: Record<string, ClassSet> = {
  sky: {
    row: 'border-l-2 border-l-sky-400 bg-sky-400/10',
    dot: 'bg-sky-400',
    swatch: 'bg-sky-400',
  },
  indigo: {
    row: 'border-l-2 border-l-indigo-400 bg-indigo-400/10',
    dot: 'bg-indigo-400',
    swatch: 'bg-indigo-400',
  },
  emerald: {
    row: 'border-l-2 border-l-emerald-500 bg-emerald-500/10',
    dot: 'bg-emerald-500',
    swatch: 'bg-emerald-500',
  },
  violet: {
    row: 'border-l-2 border-l-violet-400 bg-violet-400/10',
    dot: 'bg-violet-400',
    swatch: 'bg-violet-400',
  },
  amber: {
    row: 'border-l-2 border-l-amber-500 bg-amber-500/10',
    dot: 'bg-amber-500',
    swatch: 'bg-amber-500',
  },
  teal: {
    row: 'border-l-2 border-l-teal-400 bg-teal-400/10',
    dot: 'bg-teal-400',
    swatch: 'bg-teal-400',
  },
  rose: {
    row: 'border-l-2 border-l-rose-400 bg-rose-400/10',
    dot: 'bg-rose-400',
    swatch: 'bg-rose-400',
  },
  pink: {
    row: 'border-l-2 border-l-pink-400 bg-pink-400/10',
    dot: 'bg-pink-400',
    swatch: 'bg-pink-400',
  },
  orange: {
    row: 'border-l-2 border-l-orange-400 bg-orange-400/10',
    dot: 'bg-orange-400',
    swatch: 'bg-orange-400',
  },
  cyan: {
    row: 'border-l-2 border-l-cyan-400 bg-cyan-400/10',
    dot: 'bg-cyan-400',
    swatch: 'bg-cyan-400',
  },
  lime: {
    row: 'border-l-2 border-l-lime-500 bg-lime-500/10',
    dot: 'bg-lime-500',
    swatch: 'bg-lime-500',
  },
  fuchsia: {
    row: 'border-l-2 border-l-fuchsia-400 bg-fuchsia-400/10',
    dot: 'bg-fuchsia-400',
    swatch: 'bg-fuchsia-400',
  },
  yellow: {
    row: 'border-l-2 border-l-yellow-500 bg-yellow-500/10',
    dot: 'bg-yellow-500',
    swatch: 'bg-yellow-500',
  },
  slate: {
    row: 'border-l-2 border-l-slate-400 bg-slate-400/10',
    dot: 'bg-slate-400',
    swatch: 'bg-slate-400',
  },
}

// Inheritance: single hue (sky) with depth-based opacity fade. Static map.
const INHERITANCE_ROW: Record<number, string> = {
  1: 'border-l-2 border-l-sky-500 bg-sky-500/20',
  2: 'border-l-2 border-l-sky-500 bg-sky-500/15',
  3: 'border-l-2 border-l-sky-400 bg-sky-400/10',
  4: 'border-l-2 border-l-sky-400 bg-sky-400/10',
  5: 'border-l-2 border-l-sky-300 bg-sky-300/10',
}
const INHERITANCE_DOT: Record<number, string> = {
  1: 'bg-sky-500',
  2: 'bg-sky-500/80',
  3: 'bg-sky-400',
  4: 'bg-sky-400/70',
  5: 'bg-sky-300',
}
const INHERITANCE_FLOOR_ROW = 'border-l-2 border-l-sky-300 bg-sky-300/5'
const INHERITANCE_FLOOR_DOT = 'bg-sky-300/60'

export function rowClassName(h: HighlightInfo): string {
  if (h.mode === 'inheritance') {
    return INHERITANCE_ROW[h.depth] ?? INHERITANCE_FLOOR_ROW
  }
  return CLASS_MAP[paletteFor(h)]?.row ?? CLASS_MAP.slate!.row
}

export function dotClassName(h: HighlightInfo): string {
  if (h.mode === 'inheritance') {
    return INHERITANCE_DOT[h.depth] ?? INHERITANCE_FLOOR_DOT
  }
  return CLASS_MAP[paletteFor(h)]?.dot ?? CLASS_MAP.slate!.dot
}

export function swatchClassName(paletteKey: string): string {
  return CLASS_MAP[paletteKey]?.swatch ?? CLASS_MAP.slate!.swatch
}

export function paletteKeyForEdgeKind(kind: string): string {
  return EDGE_PALETTE[kind] ?? 'slate'
}

// ─── computations ───────────────────────────────────────────────────────────

export function computeRelations(
  pinnedPath: string,
  edges: Edge[],
  selectedKinds: Set<string>,
): Map<string, HighlightInfo> {
  const out = new Map<string, HighlightInfo>()
  for (const e of edges) {
    const kind = shortKindFromClass(e.class)
    if (kind === HAS_PARENT_KIND) continue
    if (!selectedKinds.has(kind)) continue
    const other = e.source === pinnedPath ? e.target : e.source
    if (other === pinnedPath) continue
    // First-seen kind wins. A node reached via multiple kinds keeps its
    // initial color; legend stays coherent.
    if (!out.has(other)) out.set(other, { mode: 'relations', kind })
  }
  return out
}

export function availableKindsFromEdges(edges: Edge[]): string[] {
  const seen = new Set<string>()
  for (const e of edges) {
    const kind = shortKindFromClass(e.class)
    if (kind !== HAS_PARENT_KIND) seen.add(kind)
  }
  return Array.from(seen).sort()
}

async function getLinks(
  kernel: KernelClient,
  path: string,
  edgeClasses: string[] | undefined,
  direction: 'in' | 'out' | 'both',
): Promise<Edge[]> {
  const params: { edgeClasses?: string[]; direction: 'in' | 'out' | 'both' } = { direction }
  if (edgeClasses) params.edgeClasses = edgeClasses
  const res = await kernel.call(`${path}::getLinks`, params)
  return (res as Edge[]) ?? []
}

/**
 * Some node classes (e.g. Interface instances on the current kernel) don't
 * expose `::getLinks` via instance dispatch. A failure on one node during
 * a BFS must not abort the whole traversal — we skip the node and keep
 * walking the rest of the frontier.
 */
async function tryGetLinks(
  kernel: KernelClient,
  path: string,
  edgeClasses: string[] | undefined,
  direction: 'in' | 'out' | 'both',
): Promise<Edge[]> {
  try {
    return await getLinks(kernel, path, edgeClasses, direction)
  } catch {
    return []
  }
}

function filterEdges(edges: Edge[], classes: string[], fromPath: string): Edge[] {
  const allowed = new Set(classes)
  return edges.filter((e) => allowed.has(e.class) && e.source === fromPath)
}

export async function computePermissions(
  pinnedPath: string,
  kernel: KernelClient,
): Promise<Map<string, HighlightInfo>> {
  // Step 1: identity union via extends_with (transitive). Track each
  // identity's origin so we can tag their perms as direct (the pinned
  // identity's own perms) vs union (perms brought in via extends_with).
  const originByPath = new Map<string, 'direct' | 'union'>([[pinnedPath, 'direct']])
  const queue: Array<{ path: string; depth: number }> = [{ path: pinnedPath, depth: 0 }]
  while (queue.length > 0) {
    const { path, depth } = queue.shift()!
    if (depth >= MAX_BFS_DEPTH) continue
    const all = await tryGetLinks(kernel, path, undefined, 'both')
    const exts = filterEdges(all, [EXTENDS_WITH_CLASS], path)
    for (const e of exts) {
      if (originByPath.has(e.target)) continue
      originByPath.set(e.target, 'union')
      queue.push({ path: e.target, depth: depth + 1 })
    }
  }

  // Step 2: union has_perm targets. A target reachable via both direct and
  // inherited identities is tagged direct (the strongest claim wins).
  const out = new Map<string, HighlightInfo>()
  for (const [id, origin] of originByPath) {
    const all = await tryGetLinks(kernel, id, undefined, 'both')
    const perms = filterEdges(all, [HAS_PERM_CLASS], id)
    for (const e of perms) {
      const existing = out.get(e.target)
      if (existing && existing.mode === 'permissions' && existing.source === 'direct') continue
      out.set(e.target, { mode: 'permissions', source: origin })
    }
  }
  return out
}

export async function computeInheritance(
  pinnedPath: string,
  kernel: KernelClient,
): Promise<Map<string, HighlightInfo>> {
  const out = new Map<string, HighlightInfo>()
  const visited = new Set<string>([pinnedPath])
  let frontier: string[] = [pinnedPath]
  let depth = 0
  while (frontier.length > 0 && depth < MAX_BFS_DEPTH) {
    const next: string[] = []
    for (const path of frontier) {
      const all = await tryGetLinks(kernel, path, undefined, 'both')
      const edges = filterEdges(all, [EXTENDS_CLASS, IMPLEMENTS_CLASS], path)
      for (const e of edges) {
        if (visited.has(e.target)) continue
        visited.add(e.target)
        out.set(e.target, { mode: 'inheritance', depth: depth + 1 })
        next.push(e.target)
      }
    }
    frontier = next
    depth += 1
  }
  return out
}

export async function fetchAllLinks(kernel: KernelClient, pinnedPath: string): Promise<Edge[]> {
  try {
    return await getLinks(kernel, pinnedPath, undefined, 'both')
  } catch {
    return []
  }
}

// ─── folder badges ──────────────────────────────────────────────────────────

export type TreeWalkEntry = {
  node: { id: string; path: string; __labels?: string[] }
  expanded: boolean
  children: TreeWalkEntry[] | null
}

/**
 * A collapsed container that contains a highlighted descendant gets a
 * badge. The badge carries the highlight info of the *closest* match
 * (arbitrary if several) so its color matches the content.
 */
export function computeFolderBadges(
  highlightMap: Map<string, HighlightInfo>,
  roots: TreeWalkEntry[] | null,
): Map<string, BadgeInfo> {
  const badges = new Map<string, BadgeInfo>()
  if (!roots || highlightMap.size === 0) return badges
  const entries = Array.from(highlightMap.entries())

  const walk = (items: TreeWalkEntry[]): void => {
    for (const entry of items) {
      const path = entry.node.path
      if (!entry.expanded) {
        const prefix = path.endsWith('/') ? path : path + '/'
        const hit = entries.find(([p]) => p.startsWith(prefix))
        if (hit) badges.set(path, hit[1])
      }
      if (entry.children) walk(entry.children)
    }
  }
  walk(roots)
  return badges
}
