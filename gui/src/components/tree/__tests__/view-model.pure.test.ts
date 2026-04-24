import { describe, expect, test } from 'bun:test'

import {
  availableKindsFromEdges,
  computeFolderBadges,
  computeRelations,
  dotClassName,
  paletteKeyForEdgeKind,
  rowClassName,
  shortKindFromClass,
  swatchClassName,
  type Edge,
  type HighlightInfo,
  type TreeWalkEntry,
} from '../view-model'

const K = 'kernel.astrale.ai'
const cls = (name: string) => `/:${K}:class.${name}`

describe('shortKindFromClass', () => {
  test('extracts kind from standard class path', () => {
    expect(shortKindFromClass(cls('has_parent'))).toBe('has_parent')
    expect(shortKindFromClass(cls('extends_with'))).toBe('extends_with')
  })
  test('handles arbitrary domain', () => {
    expect(shortKindFromClass('/:acme.example:class.owns')).toBe('owns')
  })
  test('returns input if no class. marker', () => {
    expect(shortKindFromClass('weird_input')).toBe('weird_input')
  })
})

describe('paletteKeyForEdgeKind', () => {
  test('maps known kinds', () => {
    expect(paletteKeyForEdgeKind('extends')).toBe('sky')
    expect(paletteKeyForEdgeKind('implements')).toBe('indigo')
    expect(paletteKeyForEdgeKind('has_perm')).toBe('emerald')
    expect(paletteKeyForEdgeKind('extends_with')).toBe('violet')
  })
  test('unknown kinds fall back to slate', () => {
    expect(paletteKeyForEdgeKind('xyz_nonexistent')).toBe('slate')
  })
})

describe('rowClassName / dotClassName', () => {
  test('relations: uses per-kind palette', () => {
    const h: HighlightInfo = { mode: 'relations', kind: 'extends' }
    expect(rowClassName(h)).toContain('sky')
    expect(rowClassName(h)).toContain('border-l-2')
    expect(dotClassName(h)).toContain('sky')
  })
  test('permissions direct = emerald, union = violet', () => {
    const direct: HighlightInfo = { mode: 'permissions', source: 'direct' }
    const union: HighlightInfo = { mode: 'permissions', source: 'union' }
    expect(rowClassName(direct)).toContain('emerald')
    expect(rowClassName(union)).toContain('violet')
  })
  test('inheritance: depth-graded sky opacity', () => {
    const d1 = rowClassName({ mode: 'inheritance', depth: 1 })
    const d5 = rowClassName({ mode: 'inheritance', depth: 5 })
    const d10 = rowClassName({ mode: 'inheritance', depth: 10 })
    expect(d1).toContain('sky')
    expect(d5).toContain('sky')
    expect(d10).toContain('sky')
    // Depth 1 should NOT equal depth 5 (different intensities).
    expect(d1).not.toBe(d5)
    // Beyond the curve everything floors to the same light shade.
    expect(rowClassName({ mode: 'inheritance', depth: 20 })).toBe(d10)
  })
  test('unknown relations kind → slate fallback', () => {
    const h: HighlightInfo = { mode: 'relations', kind: 'super_rare_kind' }
    expect(rowClassName(h)).toContain('slate')
  })
})

describe('swatchClassName', () => {
  test('returns a bg-color class', () => {
    expect(swatchClassName('sky')).toContain('sky')
    expect(swatchClassName('emerald')).toContain('emerald')
  })
})

describe('availableKindsFromEdges', () => {
  test('returns unique short kinds sorted, excluding has_parent', () => {
    const edges: Edge[] = [
      { class: cls('has_parent'), source: '/a', target: '/a/b' },
      { class: cls('extends'), source: '/a', target: '/c' },
      { class: cls('extends'), source: '/a', target: '/d' },
      { class: cls('implements'), source: '/a', target: '/e' },
      { class: cls('method_of'), source: '/f', target: '/a' },
    ]
    expect(availableKindsFromEdges(edges)).toEqual(['extends', 'implements', 'method_of'])
  })
  test('empty edges → empty array', () => {
    expect(availableKindsFromEdges([])).toEqual([])
  })
  test('only has_parent → empty array', () => {
    const edges: Edge[] = [{ class: cls('has_parent'), source: '/a', target: '/a/b' }]
    expect(availableKindsFromEdges(edges)).toEqual([])
  })
})

describe('computeRelations', () => {
  const pinned = '/kernel.astrale.ai/class.User'

  test('tags targets with their edge kind (first-seen wins)', () => {
    const edges: Edge[] = [
      { class: cls('extends'), source: pinned, target: '/super' },
      { class: cls('method_of'), source: '/method.foo', target: pinned },
    ]
    const result = computeRelations(pinned, edges, new Set(['extends', 'method_of']))
    expect(result.get('/super')).toEqual({ mode: 'relations', kind: 'extends' })
    expect(result.get('/method.foo')).toEqual({ mode: 'relations', kind: 'method_of' })
  })

  test('excludes has_parent even if in edges list', () => {
    const edges: Edge[] = [
      { class: cls('has_parent'), source: '/parent', target: pinned },
      { class: cls('extends'), source: pinned, target: '/super' },
    ]
    const result = computeRelations(pinned, edges, new Set(['has_parent', 'extends']))
    expect(result.has('/parent')).toBe(false)
    expect(result.get('/super')?.mode).toBe('relations')
  })

  test('sub-filter unchecking a kind removes those highlights', () => {
    const edges: Edge[] = [
      { class: cls('extends'), source: pinned, target: '/super' },
      { class: cls('implements'), source: pinned, target: '/iface' },
    ]
    const onlyExtends = computeRelations(pinned, edges, new Set(['extends']))
    expect(onlyExtends.has('/super')).toBe(true)
    expect(onlyExtends.has('/iface')).toBe(false)
  })

  test('self-referential edge produces no highlight', () => {
    const edges: Edge[] = [{ class: cls('calls'), source: pinned, target: pinned }]
    expect(computeRelations(pinned, edges, new Set(['calls'])).size).toBe(0)
  })

  test('first-seen kind wins when a target has multiple edge kinds', () => {
    const edges: Edge[] = [
      { class: cls('extends'), source: pinned, target: '/x' },
      { class: cls('calls'), source: pinned, target: '/x' },
    ]
    const result = computeRelations(pinned, edges, new Set(['extends', 'calls']))
    expect(result.size).toBe(1)
    expect((result.get('/x') as { kind: string }).kind).toBe('extends')
  })

  test('empty edges → empty map', () => {
    expect(computeRelations(pinned, [], new Set(['extends'])).size).toBe(0)
  })
})

// ─── folder badges ──────────────────────────────────────────────────────────

function entry(
  path: string,
  id: string,
  children: TreeWalkEntry[] | null,
  expanded: boolean,
): TreeWalkEntry {
  return { node: { id, path }, expanded, children }
}

describe('computeFolderBadges', () => {
  const directHl: HighlightInfo = { mode: 'permissions', source: 'direct' }

  test('collapsed folder with loaded highlighted descendant → badge', () => {
    const child = entry('/root/a/b', 'b', null, false)
    const folder = entry('/root/a', 'a', [child], false)
    const roots = [entry('/root', 'root', [folder], true)]
    const hl = new Map<string, HighlightInfo>([['/root/a/b', directHl]])
    const badges = computeFolderBadges(hl, roots)
    expect(badges.has('/root/a')).toBe(true)
    expect(badges.get('/root/a')).toEqual(directHl)
    expect(badges.has('/root')).toBe(false)
  })

  test('expanded folder with highlighted descendant → NO badge', () => {
    const child = entry('/root/a/b', 'b', null, false)
    const folder = entry('/root/a', 'a', [child], true)
    const roots = [entry('/root', 'root', [folder], true)]
    const hl = new Map<string, HighlightInfo>([['/root/a/b', directHl]])
    expect(computeFolderBadges(hl, roots).has('/root/a')).toBe(false)
  })

  test('collapsed folder with no matching descendant → NO badge', () => {
    const folder = entry('/root/a', 'a', null, false)
    const roots = [entry('/root', 'root', [folder], true)]
    const hl = new Map<string, HighlightInfo>([['/other/path', directHl]])
    expect(computeFolderBadges(hl, roots).has('/root/a')).toBe(false)
  })

  test('unloaded highlighted descendant → badge via path prefix', () => {
    const folder = entry('/root/deep', 'deep', null, false)
    const roots = [entry('/root', 'root', [folder], true)]
    const hl = new Map<string, HighlightInfo>([['/root/deep/nested/leaf', directHl]])
    expect(computeFolderBadges(hl, roots).has('/root/deep')).toBe(true)
  })

  test('empty highlight map → no badges', () => {
    const roots = [entry('/root', 'root', null, false)]
    expect(computeFolderBadges(new Map(), roots).size).toBe(0)
  })

  test('null roots → empty badges', () => {
    const hl = new Map<string, HighlightInfo>([['/x', directHl]])
    expect(computeFolderBadges(hl, null).size).toBe(0)
  })

  test('highlighted path equal to folder path itself does NOT badge that folder', () => {
    const folder = entry('/root/a', 'a', null, false)
    const roots = [entry('/root', 'root', [folder], true)]
    const hl = new Map<string, HighlightInfo>([['/root/a', directHl]])
    expect(computeFolderBadges(hl, roots).has('/root/a')).toBe(false)
  })

  test('badge inherits the highlight info of its descendant (color by kind)', () => {
    const child = entry('/a/b', 'b', null, false)
    const folder = entry('/a', 'a', [child], false)
    const roots = [folder]
    const extHl: HighlightInfo = { mode: 'relations', kind: 'extends' }
    const hl = new Map<string, HighlightInfo>([['/a/b', extHl]])
    expect(computeFolderBadges(hl, roots).get('/a')).toEqual(extHl)
  })
})
