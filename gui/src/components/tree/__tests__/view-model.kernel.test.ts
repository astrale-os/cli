import type { KernelClient } from '@astrale-os/shell'

import { describe, expect, test } from 'bun:test'

import { computeInheritance, computePermissions, type Edge } from '../view-model'

const K = 'kernel.astrale.ai'
const cls = (name: string) => `/:${K}:class.${name}`

type GetLinksParams = {
  edgeClasses?: string[]
  direction: 'in' | 'out' | 'both'
}

function makeKernel(allEdges: Edge[]): { kernel: KernelClient; callCount: () => number } {
  let count = 0
  const kernel = {
    call: async (method: string, params: unknown) => {
      count += 1
      const sep = method.lastIndexOf('::')
      if (sep < 0) throw new Error(`mock: bad method ${method}`)
      const path = method.slice(0, sep)
      const op = method.slice(sep + 2)
      if (op !== 'getLinks') throw new Error(`mock: only getLinks supported, got ${op}`)
      const p = params as GetLinksParams
      const dir = p.direction ?? 'both'
      return allEdges.filter((e) => {
        const matchesKind = !p.edgeClasses || p.edgeClasses.includes(e.class)
        if (!matchesKind) return false
        if (dir === 'both') return e.source === path || e.target === path
        if (dir === 'out') return e.source === path
        if (dir === 'in') return e.target === path
        return false
      })
    },
  } as unknown as KernelClient
  return { kernel, callCount: () => count }
}

// ─── inheritance view ───────────────────────────────────────────────────────

describe('computeInheritance', () => {
  test('simple extends chain: A → B → C', async () => {
    const edges: Edge[] = [
      { class: cls('extends'), source: '/A', target: '/B' },
      { class: cls('extends'), source: '/B', target: '/C' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computeInheritance('/A', kernel)
    expect(hl.get('/B')).toEqual({ mode: 'inheritance', depth: 1 })
    expect(hl.get('/C')).toEqual({ mode: 'inheritance', depth: 2 })
    expect(hl.has('/A')).toBe(false)
  })

  test('implements + extends mix counted as single hop each', async () => {
    const edges: Edge[] = [
      { class: cls('implements'), source: '/A', target: '/I' },
      { class: cls('extends'), source: '/I', target: '/J' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computeInheritance('/A', kernel)
    expect(hl.get('/I')).toEqual({ mode: 'inheritance', depth: 1 })
    expect(hl.get('/J')).toEqual({ mode: 'inheritance', depth: 2 })
  })

  test('diamond: first-seen depth wins (BFS)', async () => {
    const edges: Edge[] = [
      { class: cls('extends'), source: '/A', target: '/B' },
      { class: cls('extends'), source: '/A', target: '/C' },
      { class: cls('extends'), source: '/B', target: '/D' },
      { class: cls('extends'), source: '/C', target: '/D' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computeInheritance('/A', kernel)
    expect((hl.get('/B') as { depth: number }).depth).toBe(1)
    expect((hl.get('/C') as { depth: number }).depth).toBe(1)
    expect((hl.get('/D') as { depth: number }).depth).toBe(2)
  })

  test('cycle guard: A extends B extends A does not loop', async () => {
    const edges: Edge[] = [
      { class: cls('extends'), source: '/A', target: '/B' },
      { class: cls('extends'), source: '/B', target: '/A' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computeInheritance('/A', kernel)
    expect((hl.get('/B') as { depth: number }).depth).toBe(1)
    expect(hl.has('/A')).toBe(false)
  })

  test('only out-direction followed (subtypes NOT included)', async () => {
    const edges: Edge[] = [
      { class: cls('extends'), source: '/X', target: '/A' },
      { class: cls('extends'), source: '/A', target: '/Super' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computeInheritance('/A', kernel)
    expect(hl.has('/X')).toBe(false)
    expect((hl.get('/Super') as { depth: number }).depth).toBe(1)
  })

  test('no extends or implements → empty map', async () => {
    const edges: Edge[] = [{ class: cls('calls'), source: '/A', target: '/B' }]
    const { kernel } = makeKernel(edges)
    expect((await computeInheritance('/A', kernel)).size).toBe(0)
  })

  test('depth increments correctly through 5 hops', async () => {
    const edges: Edge[] = [
      { class: cls('extends'), source: '/L0', target: '/L1' },
      { class: cls('extends'), source: '/L1', target: '/L2' },
      { class: cls('extends'), source: '/L2', target: '/L3' },
      { class: cls('extends'), source: '/L3', target: '/L4' },
      { class: cls('extends'), source: '/L4', target: '/L5' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computeInheritance('/L0', kernel)
    expect((hl.get('/L1') as { depth: number }).depth).toBe(1)
    expect((hl.get('/L5') as { depth: number }).depth).toBe(5)
  })

  test('BFS tolerates per-node getLinks failures (e.g., Interface nodes)', async () => {
    const edges: Edge[] = [
      { class: cls('extends'), source: '/A', target: '/B' },
      { class: cls('extends'), source: '/A', target: '/FAIL' },
      { class: cls('extends'), source: '/B', target: '/C' },
    ]
    const kernel = {
      call: async (method: string, params: unknown) => {
        const path = method.slice(0, method.lastIndexOf('::'))
        if (path === '/FAIL') throw new Error('method not found')
        const p = params as { edgeClasses?: string[]; direction: 'in' | 'out' | 'both' }
        return edges.filter((e) => {
          if (p.edgeClasses && !p.edgeClasses.includes(e.class)) return false
          if (p.direction === 'out') return e.source === path
          if (p.direction === 'in') return e.target === path
          return e.source === path || e.target === path
        })
      },
    } as unknown as KernelClient
    const hl = await computeInheritance('/A', kernel)
    expect((hl.get('/B') as { depth: number }).depth).toBe(1)
    expect((hl.get('/FAIL') as { depth: number }).depth).toBe(1)
    expect((hl.get('/C') as { depth: number }).depth).toBe(2)
  })
})

// ─── permissions view ───────────────────────────────────────────────────────

describe('computePermissions', () => {
  test('direct has_perm → source = direct', async () => {
    const edges: Edge[] = [
      { class: cls('has_perm'), source: '/user', target: '/res/a' },
      { class: cls('has_perm'), source: '/user', target: '/res/b' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computePermissions('/user', kernel)
    expect(hl.get('/res/a')).toEqual({ mode: 'permissions', source: 'direct' })
    expect(hl.get('/res/b')).toEqual({ mode: 'permissions', source: 'direct' })
  })

  test('transitive extends_with: perms from admin tagged as union', async () => {
    const edges: Edge[] = [
      { class: cls('extends_with'), source: '/user', target: '/admin' },
      { class: cls('has_perm'), source: '/user', target: '/res/user-only' },
      { class: cls('has_perm'), source: '/admin', target: '/res/admin-only' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computePermissions('/user', kernel)
    expect(hl.get('/res/user-only')).toEqual({ mode: 'permissions', source: 'direct' })
    expect(hl.get('/res/admin-only')).toEqual({ mode: 'permissions', source: 'union' })
  })

  test('target granted by both direct and union: direct wins', async () => {
    const edges: Edge[] = [
      { class: cls('extends_with'), source: '/user', target: '/admin' },
      { class: cls('has_perm'), source: '/user', target: '/shared' },
      { class: cls('has_perm'), source: '/admin', target: '/shared' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computePermissions('/user', kernel)
    expect(hl.size).toBe(1)
    expect(hl.get('/shared')).toEqual({ mode: 'permissions', source: 'direct' })
  })

  test('multi-hop extends_with: deeply-inherited perms tagged as union', async () => {
    const edges: Edge[] = [
      { class: cls('extends_with'), source: '/A', target: '/B' },
      { class: cls('extends_with'), source: '/B', target: '/C' },
      { class: cls('has_perm'), source: '/C', target: '/pC' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computePermissions('/A', kernel)
    expect(hl.get('/pC')).toEqual({ mode: 'permissions', source: 'union' })
  })

  test('cycle guard does not loop', async () => {
    const edges: Edge[] = [
      { class: cls('extends_with'), source: '/A', target: '/B' },
      { class: cls('extends_with'), source: '/B', target: '/A' },
      { class: cls('has_perm'), source: '/A', target: '/p' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computePermissions('/A', kernel)
    expect(hl.size).toBe(1)
    expect(hl.get('/p')?.mode).toBe('permissions')
  })

  test('no perms → empty map', async () => {
    const edges: Edge[] = [{ class: cls('extends_with'), source: '/A', target: '/B' }]
    const { kernel } = makeKernel(edges)
    expect((await computePermissions('/A', kernel)).size).toBe(0)
  })

  test('incoming extends_with NOT followed (union is directional)', async () => {
    const edges: Edge[] = [
      { class: cls('extends_with'), source: '/B', target: '/A' },
      { class: cls('has_perm'), source: '/B', target: '/pB' },
      { class: cls('has_perm'), source: '/A', target: '/pA' },
    ]
    const { kernel } = makeKernel(edges)
    const hl = await computePermissions('/A', kernel)
    expect(hl.has('/pA')).toBe(true)
    expect(hl.has('/pB')).toBe(false)
  })

  test('incoming has_perm (someone else on this node) NOT included', async () => {
    const edges: Edge[] = [{ class: cls('has_perm'), source: '/other', target: '/user' }]
    const { kernel } = makeKernel(edges)
    expect((await computePermissions('/user', kernel)).size).toBe(0)
  })
})
