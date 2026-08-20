import type {
  IrDefinitionKey,
  IrDefinitionRef,
  IrSchemaRef,
  StudioSchemaBundle,
} from '@shared/types'

/**
 * Modules are schema folders. Every member (interface, class, edge) is authored
 * in a source file, but files are implementation detail rather than navigation
 * nodes. The ts-morph source span locates that file; its containing folder owns
 * the member in both the tree and canvas.
 */

export type MemberKind = 'interface' | 'class' | 'edge'

export type InterfaceDefinitionRef = IrDefinitionRef & { kind: 'interface' }
export type InterfaceReference = InterfaceDefinitionRef | string

export interface InterfaceBadge {
  /** Short display label. */
  name: string
  /** Canonical key, or a stable compatibility identity for a name-only legacy reference. */
  identity: string
  /** Canonical ref. Absent only for name-only legacy projections. */
  ref?: InterfaceDefinitionRef
  /** Detail-pane selection token; exact for imported canonical refs, short for legacy refs. */
  selectionId: string
}

export interface MemberRef {
  name: string
  kind: MemberKind
  /** id used for selection / detail (edges live in ir.classes, so class.<name>) */
  selectId: string
  ref: string // anchor ref (class.X / interface.X / edge.X)
  icon?: string // class-level SVG icon, if declared
}

export interface TreeNode {
  name: string
  path: string // folder path relative to schemaDir (`root` = schemaDir itself)
  hue: number
  children: TreeNode[]
  members: MemberRef[]
}

export interface FolderModule {
  path: string // 'orders' (`root` = schemaDir itself)
  label: string
  hue: number
  classes: string[]
  interfaces: string[]
  edges: string[]
}

const HUES = [264, 190, 150, 90, 30, 320, 220, 55, 0, 170, 120, 290]
const KERNEL_ORIGIN = 'kernel.astrale.ai'

function isInterfaceRef(ref: IrSchemaRef): ref is InterfaceDefinitionRef {
  return ref.kind === 'interface'
}

function definitionKey(ref: IrDefinitionRef): IrDefinitionKey {
  return `${ref.origin}:${ref.kind}.${ref.name}`
}

/** Collision-free identity for a canonical ref; stable short identity for legacy input. */
export function interfaceIdentity(ref: InterfaceReference): string {
  return typeof ref === 'string' ? `legacy:interface.${ref}` : definitionKey(ref)
}

/**
 * Detail-pane selection for an interface. Local refs retain the legacy short selection while
 * imported refs use their canonical key so homonyms from different origins stay distinct.
 */
export function interfaceSelectionId(ref: InterfaceReference, localOrigin?: string): string {
  if (typeof ref === 'string') return `interface.${ref}`
  return ref.origin === localOrigin
    ? `interface.${ref.name}`
    : `interface.${interfaceIdentity(ref)}`
}

/** Parse the qualified portion after `interface.` from an imported-interface selection. */
export function parseInterfaceSelectionToken(token: string): InterfaceDefinitionRef | undefined {
  const match = /^(.+):interface\.([A-Za-z_$][\w$]*)$/.exec(token)
  if (!match) return undefined
  return { origin: match[1], kind: 'interface', name: match[2] }
}

export function interfaceBadge(ref: InterfaceReference, localOrigin?: string): InterfaceBadge {
  return {
    name: typeof ref === 'string' ? ref : ref.name,
    identity: interfaceIdentity(ref),
    ...(typeof ref === 'string' ? {} : { ref }),
    selectionId: interfaceSelectionId(ref, localOrigin),
  }
}
export function moduleHue(index: number): number {
  return HUES[index % HUES.length]
}

interface SchemaLocation {
  /** Source file relative to schemaDir, without extension (`orders/order`). */
  sourcePath: string
  /** Containing folder relative to schemaDir (`orders`); root-level files use `root`. */
  modulePath: string
}

function schemaLocation(file: string | undefined, schemaDir: string): SchemaLocation {
  if (!file) return { sourcePath: 'root', modulePath: 'root' }
  const parts = file.split('/').filter(Boolean)
  const si = parts.lastIndexOf(schemaDir)
  const rest = si >= 0 ? parts.slice(si + 1) : parts
  if (rest.length === 0) return { sourcePath: 'root', modulePath: 'root' }
  rest[rest.length - 1] = rest[rest.length - 1].replace(/\.tsx?$/, '')
  return {
    sourcePath: rest.join('/'),
    modulePath: rest.length > 1 ? rest.slice(0, -1).join('/') : 'root',
  }
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
  modulePath: string
  sourcePath: string
  icon?: string
}

function collectMembers(bundle: StudioSchemaBundle, schemaDir: string): RawMember[] {
  const ir = bundle.ir
  if (!ir) return []
  const out: RawMember[] = []
  const fileOf = (key: string) => bundle.overlay.sourceSpans[key]?.file
  for (const name of Object.keys(ir.interfaces)) {
    const location = schemaLocation(fileOf(`interface.${name}`), schemaDir)
    out.push({
      name,
      kind: 'interface',
      ...location,
    })
  }
  for (const [name, c] of Object.entries(ir.classes)) {
    const kind: MemberKind = c.type === 'edge' ? 'edge' : 'class'
    const location = schemaLocation(fileOf(`${kind}.${name}`), schemaDir)
    out.push({
      name,
      kind,
      ...location,
      icon: c.icon,
    })
  }
  return out
}

/** A hue per top-level folder, stable across renders. */
function topHueMap(members: RawMember[]): Map<string, number> {
  const tops = [...new Set(members.map((m) => m.modulePath.split('/')[0]))].sort()
  const map = new Map<string, number>()
  tops.forEach((t, i) => map.set(t, moduleHue(i)))
  return map
}

export function buildModuleTree(bundle: StudioSchemaBundle, schemaDir = 'schema'): TreeNode {
  const members = collectMembers(bundle, schemaDir)
  const hueMap = topHueMap(members)
  const root: TreeNode = {
    name: schemaDir,
    path: '',
    hue: 0,
    children: [],
    members: [],
  }

  for (const m of members) {
    const segs = m.modulePath === 'root' ? [] : m.modulePath.split('/')
    const top = segs[0]
    const hue = hueMap.get(top ?? 'root') ?? 264
    let node = root
    if (segs.length === 0) {
      let schemaRoot = root.children.find((c) => c.path === 'root')
      if (!schemaRoot) {
        schemaRoot = { name: schemaDir, path: 'root', hue, children: [], members: [] }
        root.children.push(schemaRoot)
      }
      node = schemaRoot
    }
    for (let i = 0; i < segs.length; i++) {
      const name = segs[i]
      const path = segs.slice(0, i + 1).join('/')
      let next = node.children.find((c) => c.path === path)
      if (!next) {
        next = { name, path, hue, children: [], members: [] }
        node.children.push(next)
      }
      node = next
    }
    node.members.push({
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
  node.children.sort((a, b) => a.name.localeCompare(b.name))
  const order: Record<MemberKind, number> = { interface: 0, class: 1, edge: 2 }
  node.members.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
  node.children.forEach(sortTree)
}

/** Folder modules with their directly-authored members (for canvas grouping). */
export function folderModules(bundle: StudioSchemaBundle, schemaDir = 'schema'): FolderModule[] {
  const ir = bundle.ir
  if (!ir) return []
  const members = collectMembers(bundle, schemaDir)
  const hueMap = topHueMap(members)
  const byPath = new Map<string, FolderModule>()
  for (const m of members) {
    const top = m.modulePath.split('/')[0]
    if (!byPath.has(m.modulePath)) {
      byPath.set(m.modulePath, {
        path: m.modulePath,
        label: m.modulePath === 'root' ? schemaDir : m.modulePath,
        hue: hueMap.get(top) ?? 264,
        classes: [],
        interfaces: [],
        edges: [],
      })
    }
    const fm = byPath.get(m.modulePath)!
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
export function implementedInterfaceRefsOf(
  bundle: StudioSchemaBundle,
  className: string,
): InterfaceDefinitionRef[] {
  const ir = bundle.ir
  const cls = ir?.classes[className]
  if (!ir || !cls) return []
  if (cls.implementsRefs !== undefined) return cls.implementsRefs.filter(isInterfaceRef)

  // Legacy projections carry only names. Reconstruct a ref only where their local/import maps
  // identify one interface; canonical consumers never enter this branch.
  return (cls.implements ?? []).flatMap((name) => {
    if (ir.interfaces[name]) return [{ origin: ir.domain, kind: 'interface' as const, name }]
    const descriptor = ir.imports[name]
    if (!descriptor || descriptor.definition !== 'interface') return []
    return [
      descriptor.ref?.kind === 'interface'
        ? { origin: descriptor.ref.origin, kind: 'interface' as const, name: descriptor.ref.name }
        : { origin: descriptor.origin, kind: 'interface' as const, name },
    ]
  })
}

export function domainInterfacesOf(
  bundle: StudioSchemaBundle,
  className: string,
): InterfaceReference[] {
  const ir = bundle.ir
  if (!ir) return []
  const cls = ir.classes[className]
  if (!cls) return []
  if (cls.implementsRefs === undefined) {
    return (cls.implements ?? []).filter((name) => {
      if (ir.interfaces[name]) return true
      const descriptor = ir.imports[name]
      return descriptor?.definition === 'interface' && descriptor.origin !== KERNEL_ORIGIN
    })
  }
  return implementedInterfaceRefsOf(bundle, className).filter((ref) => {
    if (ref.origin === ir.domain) return ir.interfaces[ref.name] !== undefined
    return ref.origin !== KERNEL_ORIGIN
  })
}

/** Origin of an implemented EXTERNAL non-kernel interface (so a badge can mark it cross-domain). */
export function externalInterfaceOrigin(
  bundle: StudioSchemaBundle,
  iface: string | IrDefinitionRef,
): string | null {
  const ir = bundle.ir
  if (!ir) return null
  if (typeof iface !== 'string') {
    if (iface.kind !== 'interface' || iface.origin === ir.domain || iface.origin === KERNEL_ORIGIN)
      return null
    return iface.origin
  }
  const imp = ir.imports[iface]
  return imp && imp.definition === 'interface' && imp.origin !== KERNEL_ORIGIN ? imp.origin : null
}

export function moduleOfClass(
  bundle: StudioSchemaBundle,
  className: string,
  schemaDir = 'schema',
): string {
  return schemaLocation(bundle.overlay.sourceSpans[`class.${className}`]?.file, schemaDir)
    .modulePath
}

export function moduleOfInterface(
  bundle: StudioSchemaBundle,
  ifaceName: string,
  schemaDir = 'schema',
): string {
  return schemaLocation(bundle.overlay.sourceSpans[`interface.${ifaceName}`]?.file, schemaDir)
    .modulePath
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

/** All members of a folder module, including members in nested folders. */
export function moduleMembers(
  bundle: StudioSchemaBundle,
  path: string,
  schemaDir = 'schema',
): ModuleInfo {
  const members = collectMembers(bundle, schemaDir)
  const hueMap = topHueMap(members)
  const inModule = (modulePath: string) =>
    modulePath === path || (path !== 'root' && modulePath.startsWith(`${path}/`))
  const segs = path.split('/')
  const out: ModuleInfo = {
    path,
    label: path === 'root' ? schemaDir : path,
    hue: hueMap.get(segs[0]) ?? 264,
    interfaces: [],
    classes: [],
    edges: [],
    files: [],
  }
  const files = new Set<string>()
  for (const m of members) {
    if (!inModule(m.modulePath)) continue
    files.add(m.sourcePath)
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
