import type { StudioSchemaBundle } from '@shared/types'

/** Schema folders own authored Node and Edge Classes; files remain implementation detail. */
export type MemberKind = 'class' | 'edge'

export interface MemberRef {
  name: string
  kind: MemberKind
  selectId: string
  ref: string
  icon?: string
}

export interface TreeNode {
  name: string
  path: string
  hue: number
  children: TreeNode[]
  members: MemberRef[]
}

export interface FolderModule {
  path: string
  label: string
  hue: number
  classes: string[]
  edges: string[]
}

const HUES = [264, 190, 150, 90, 30, 320, 220, 55, 0, 170, 120, 290]

export function moduleHue(index: number): number {
  return HUES[index % HUES.length]
}

export function memberRefKey(kind: MemberKind, name: string): string {
  return `${kind}.${name}`
}

interface SchemaLocation {
  sourcePath: string
  modulePath: string
}

interface RawMember extends SchemaLocation {
  name: string
  kind: MemberKind
  icon?: string
}

function schemaLocation(file: string | undefined, schemaDir: string): SchemaLocation {
  if (!file) return { sourcePath: 'root', modulePath: 'root' }
  const parts = file.split('/').filter(Boolean)
  const schemaParts = schemaDir.split('/').filter(Boolean)
  let start = -1
  for (let index = 0; index <= parts.length - schemaParts.length; index += 1) {
    if (schemaParts.every((part, offset) => parts[index + offset] === part)) {
      start = index + schemaParts.length
    }
  }
  const rest = start >= 0 ? parts.slice(start) : parts
  if (rest.length === 0) return { sourcePath: 'root', modulePath: 'root' }
  rest[rest.length - 1] = rest[rest.length - 1].replace(/\.tsx?$/u, '')
  return {
    sourcePath: rest.join('/'),
    modulePath: rest.length > 1 ? rest.slice(0, -1).join('/') : 'root',
  }
}

function collectMembers(bundle: StudioSchemaBundle, schemaDir: string): RawMember[] {
  if (!bundle.ir) return []
  return Object.entries(bundle.ir.classes).map(([name, value]) => {
    const kind: MemberKind = value.type === 'edge' ? 'edge' : 'class'
    return {
      name,
      kind,
      ...schemaLocation(bundle.overlay.sourceSpans[`${kind}.${name}`]?.file, schemaDir),
      icon: value.icon,
    }
  })
}

function topHueMap(members: readonly RawMember[]): Map<string, number> {
  const roots = [...new Set(members.map((member) => member.modulePath.split('/')[0]))].sort()
  return new Map(roots.map((root, index) => [root, moduleHue(index)]))
}

function member(member: RawMember): MemberRef {
  return {
    name: member.name,
    kind: member.kind,
    selectId: `class.${member.name}`,
    ref: memberRefKey(member.kind, member.name),
    icon: member.icon,
  }
}

export function buildModuleTree(bundle: StudioSchemaBundle, schemaDir = 'schema'): TreeNode {
  const members = collectMembers(bundle, schemaDir)
  const hues = topHueMap(members)
  const root: TreeNode = { name: schemaDir, path: '', hue: 0, children: [], members: [] }
  for (const value of members) {
    const segments = value.modulePath === 'root' ? [] : value.modulePath.split('/')
    const hue = hues.get(segments[0] ?? 'root') ?? 264
    let node = root
    if (segments.length === 0) {
      let schemaRoot = root.children.find((child) => child.path === 'root')
      if (!schemaRoot) {
        schemaRoot = { name: schemaDir, path: 'root', hue, children: [], members: [] }
        root.children.push(schemaRoot)
      }
      node = schemaRoot
    }
    for (let index = 0; index < segments.length; index += 1) {
      const path = segments.slice(0, index + 1).join('/')
      let child = node.children.find((candidate) => candidate.path === path)
      if (!child) {
        child = { name: segments[index], path, hue, children: [], members: [] }
        node.children.push(child)
      }
      node = child
    }
    node.members.push(member(value))
  }
  sortTree(root)
  return root
}

function sortTree(node: TreeNode): void {
  node.children.sort((left, right) => left.name.localeCompare(right.name))
  node.members.sort(
    (left, right) =>
      Number(left.kind === 'edge') - Number(right.kind === 'edge') ||
      left.name.localeCompare(right.name),
  )
  node.children.forEach(sortTree)
}

function moduleLabel(modulePath: string, schemaDir: string): string {
  if (modulePath === 'root') return schemaDir

  const moduleName = /^modules\/([^/]+)\/classes$/u.exec(modulePath)?.[1]
  if (!moduleName) return modulePath

  const words = moduleName
    .replace(/([a-z\d])([A-Z])/gu, '$1 $2')
    .split(/[-_\s]+/u)
    .filter(Boolean)
  if (words.length === 0) return modulePath

  return words.map((word) => word[0]?.toLocaleUpperCase() + word.slice(1)).join(' ')
}

export function folderModules(bundle: StudioSchemaBundle, schemaDir = 'schema'): FolderModule[] {
  const members = collectMembers(bundle, schemaDir)
  const hues = topHueMap(members)
  const modules = new Map<string, FolderModule>()
  for (const value of members) {
    const top = value.modulePath.split('/')[0]
    const selected = modules.get(value.modulePath) ?? {
      path: value.modulePath,
      label: moduleLabel(value.modulePath, schemaDir),
      hue: hues.get(top) ?? 264,
      classes: [],
      edges: [],
    }
    selected[value.kind === 'edge' ? 'edges' : 'classes'].push(value.name)
    modules.set(value.modulePath, selected)
  }
  for (const value of modules.values()) {
    value.classes.sort()
    value.edges.sort()
  }
  return [...modules.values()].sort((left, right) => left.path.localeCompare(right.path))
}

export function moduleOfClass(
  bundle: StudioSchemaBundle,
  className: string,
  schemaDir = 'schema',
): string {
  return schemaLocation(bundle.overlay.sourceSpans[`class.${className}`]?.file, schemaDir)
    .modulePath
}
