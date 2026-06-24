import type { StudioSchemaBundle } from '@shared/types'

/**
 * Modules are the schema's file/folder namespaces. Every member (interface,
 * class, edge) is authored in exactly one file — e.g. schema/orders/orders.ts
 * owns the Fulfillable interface + Order/OrderLine classes + their edges. We
 * exploit the ts-morph overlay (sourceSpans, which carries each member's file)
 * to build the full folder → file → members tree.
 */

export type MemberKind = 'interface' | 'class' | 'edge'

export interface MemberRef {
  name: string
  kind: MemberKind
  /** id used for selection / detail (edges live in ir.classes, so class.<name>) */
  selectId: string
  ref: string // anchor ref (class.X / interface.X / edge.X)
  icon?: string // class-level SVG icon, if declared
}

export interface TreeNode {
  type: 'folder' | 'file'
  name: string
  path: string // relative to schemaDir, no extension for files
  hue: number
  children: TreeNode[]
  members: MemberRef[]
}

export interface FileModule {
  path: string // 'orders/orders'
  topFolder: string // 'orders'
  label: string
  hue: number
  classes: string[]
  interfaces: string[]
  edges: string[]
}

const HUES = [264, 190, 150, 90, 30, 320, 220, 55, 0, 170, 120, 290]
export function moduleHue(index: number): number {
  return HUES[index % HUES.length]
}

/** strip the leading schemaDir segment and the file extension → 'orders/orders'. */
function fileModulePath(file: string | undefined, schemaDir: string): string {
  if (!file) return 'root'
  const parts = file.split('/').filter(Boolean)
  const si = parts.lastIndexOf(schemaDir)
  const rest = si >= 0 ? parts.slice(si + 1) : parts
  if (rest.length === 0) return 'root'
  rest[rest.length - 1] = rest[rest.length - 1].replace(/\.tsx?$/, '')
  return rest.join('/')
}

function memberSelectId(kind: MemberKind, name: string): string {
  return kind === 'interface' ? `interface.${name}` : `class.${name}`
}
/** The hide-set / anchor key for a member. Exported as the SOLE owner of the
 *  `<kind>.<name>` scheme — visibility.ts's ref builders delegate here so the keys
 *  the tree writes and the policy reads can never silently diverge. */
export function memberRefKey(kind: MemberKind, name: string): string {
  return `${kind}.${name}`
}

interface RawMember {
  name: string
  kind: MemberKind
  modPath: string
  icon?: string
}

function collectMembers(bundle: StudioSchemaBundle, schemaDir: string): RawMember[] {
  const ir = bundle.ir
  if (!ir) return []
  const out: RawMember[] = []
  const fileOf = (key: string) => bundle.overlay.sourceSpans[key]?.file
  for (const name of Object.keys(ir.interfaces)) {
    out.push({
      name,
      kind: 'interface',
      modPath: fileModulePath(fileOf(`interface.${name}`), schemaDir),
    })
  }
  for (const [name, c] of Object.entries(ir.classes)) {
    const kind: MemberKind = c.type === 'edge' ? 'edge' : 'class'
    out.push({
      name,
      kind,
      modPath: fileModulePath(fileOf(`${kind}.${name}`), schemaDir),
      icon: c.icon,
    })
  }
  return out
}

/** A hue per top-level folder/file, stable across renders. */
function topHueMap(members: RawMember[]): Map<string, number> {
  const tops = [...new Set(members.map((m) => m.modPath.split('/')[0]))].sort()
  const map = new Map<string, number>()
  tops.forEach((t, i) => map.set(t, moduleHue(i)))
  return map
}

export function buildModuleTree(bundle: StudioSchemaBundle, schemaDir = 'schema'): TreeNode {
  const members = collectMembers(bundle, schemaDir)
  const hueMap = topHueMap(members)
  const root: TreeNode = {
    type: 'folder',
    name: schemaDir,
    path: '',
    hue: 0,
    children: [],
    members: [],
  }

  for (const m of members) {
    const segs = m.modPath.split('/')
    const top = segs[0]
    const hue = hueMap.get(top) ?? 264
    let node = root
    // walk/create folder nodes for all but the last segment
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i]
      const path = segs.slice(0, i + 1).join('/')
      let next = node.children.find((c) => c.type === 'folder' && c.name === seg)
      if (!next) {
        next = { type: 'folder', name: seg, path, hue, children: [], members: [] }
        node.children.push(next)
      }
      node = next
    }
    // the file node (last segment)
    const fileSeg = segs[segs.length - 1]
    let file = node.children.find((c) => c.type === 'file' && c.name === fileSeg)
    if (!file) {
      file = { type: 'file', name: fileSeg, path: m.modPath, hue, children: [], members: [] }
      node.children.push(file)
    }
    file.members.push({
      name: m.name,
      kind: m.kind,
      selectId: memberSelectId(m.kind, m.name),
      ref: memberRefKey(m.kind, m.name),
      icon: m.icon,
    })
  }

  sortTree(root)
  return root
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1,
  )
  const order: Record<MemberKind, number> = { interface: 0, class: 1, edge: 2 }
  node.members.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
  node.children.forEach(sortTree)
}

/** File-modules with their members (for canvas grouping). */
export function fileModules(bundle: StudioSchemaBundle, schemaDir = 'schema'): FileModule[] {
  const ir = bundle.ir
  if (!ir) return []
  const members = collectMembers(bundle, schemaDir)
  const hueMap = topHueMap(members)
  const byPath = new Map<string, FileModule>()
  for (const m of members) {
    const top = m.modPath.split('/')[0]
    if (!byPath.has(m.modPath)) {
      byPath.set(m.modPath, {
        path: m.modPath,
        topFolder: top,
        label: m.modPath,
        hue: hueMap.get(top) ?? 264,
        classes: [],
        interfaces: [],
        edges: [],
      })
    }
    const fm = byPath.get(m.modPath)!
    if (m.kind === 'class') fm.classes.push(m.name)
    else if (m.kind === 'interface') fm.interfaces.push(m.name)
    else fm.edges.push(m.name)
  }
  for (const fm of byPath.values()) {
    fm.classes.sort()
    fm.interfaces.sort()
    fm.edges.sort()
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** Interfaces a class implements, shown as badges: its OWN + EXTERNAL non-kernel ones.
 *  Kernel interfaces (Node, Named, Iconable…) are structural noise — never badged. */
export function domainInterfacesOf(bundle: StudioSchemaBundle, className: string): string[] {
  const ir = bundle.ir
  if (!ir) return []
  return (ir.classes[className]?.implements ?? []).filter((i) => {
    if (ir.interfaces[i]) return true // own domain interface
    const imp = ir.imports[i]
    return !!imp && imp.definition === 'interface' && imp.origin !== 'kernel.astrale.ai' // external, non-kernel
  })
}

/** Origin of an implemented EXTERNAL non-kernel interface (so a badge can mark it cross-domain). */
export function externalInterfaceOrigin(bundle: StudioSchemaBundle, iface: string): string | null {
  const imp = bundle.ir?.imports[iface]
  return imp && imp.definition === 'interface' && imp.origin !== 'kernel.astrale.ai'
    ? imp.origin
    : null
}

export function moduleOfClass(
  bundle: StudioSchemaBundle,
  className: string,
  schemaDir = 'schema',
): string {
  return fileModulePath(bundle.overlay.sourceSpans[`class.${className}`]?.file, schemaDir)
}

export interface ModuleInfo {
  path: string
  label: string
  hue: number
  interfaces: MemberRef[]
  classes: MemberRef[]
  edges: MemberRef[]
  files: string[]
}

/** All members of a module path (a file like 'orders/orders' or a folder like 'orders'). */
export function moduleMembers(
  bundle: StudioSchemaBundle,
  path: string,
  schemaDir = 'schema',
): ModuleInfo {
  const members = collectMembers(bundle, schemaDir)
  const hueMap = topHueMap(members)
  const inModule = (mp: string) => mp === path || mp.startsWith(`${path}/`)
  const segs = path.split('/')
  const out: ModuleInfo = {
    path,
    label: segs.length === 2 && segs[0] === segs[1] ? segs[0] : path,
    hue: hueMap.get(segs[0]) ?? 264,
    interfaces: [],
    classes: [],
    edges: [],
    files: [],
  }
  const files = new Set<string>()
  for (const m of members) {
    if (!inModule(m.modPath)) continue
    files.add(m.modPath)
    const ref: MemberRef = {
      name: m.name,
      kind: m.kind,
      selectId: memberSelectId(m.kind, m.name),
      ref: memberRefKey(m.kind, m.name),
      icon: m.icon,
    }
    if (m.kind === 'interface') out.interfaces.push(ref)
    else if (m.kind === 'edge') out.edges.push(ref)
    else out.classes.push(ref)
  }
  out.files = [...files].sort()
  out.interfaces.sort((a, b) => a.name.localeCompare(b.name))
  out.classes.sort((a, b) => a.name.localeCompare(b.name))
  out.edges.sort((a, b) => a.name.localeCompare(b.name))
  return out
}
