import type { StudioSchemaBundle } from '@shared/contracts/schema'

/** Authored declarations share a module folder; technical subfolders stay out of the tree. */
export type MemberKind = 'class' | 'edge' | 'policy' | 'function' | 'view'

interface FolderModule {
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
    modulePath:
      rest[0] === 'modules' && rest.length > 2
        ? rest.slice(0, 2).join('/')
        : rest.length > 1 &&
            !['classes', 'policies', 'functions', 'views', 'types', 'states', 'errors'].includes(
              rest[0]!,
            )
          ? rest[0]!
          : 'root',
  }
}

function locate(bundle: StudioSchemaBundle, key: string, schemaDir: string): SchemaLocation {
  return schemaLocation(bundle.overlay.sourceSpans[key]?.file, schemaDir)
}

function collectClasses(bundle: StudioSchemaBundle, schemaDir: string): RawMember[] {
  if (!bundle.ir) return []
  return Object.entries(bundle.ir.classes).map(([name, value]) => {
    const kind: MemberKind = value.type === 'edge' ? 'edge' : 'class'
    return {
      name,
      kind,
      ...locate(bundle, `${kind}.${name}`, schemaDir),
      icon: value.icon,
    }
  })
}

/** The module a declaration lives in, from its source location; `'root'` outside any. */
export function moduleOfMember(
  bundle: StudioSchemaBundle,
  kind: MemberKind,
  name: string,
  schemaDir = 'schema',
): string {
  return locate(bundle, `${kind}.${name}`, schemaDir).modulePath
}

/** Each Class module's hue, as the tree and the canvas paint it. */
export function moduleHues(bundle: StudioSchemaBundle, schemaDir = 'schema'): Map<string, number> {
  return topHueMap(collectClasses(bundle, schemaDir))
}

function topHueMap(members: readonly RawMember[]): Map<string, number> {
  const roots = [...new Set(members.map((member) => member.modulePath))].sort()
  return new Map(roots.map((root, index) => [root, moduleHue(index)]))
}

export function moduleLabel(modulePath: string, schemaDir: string): string {
  if (modulePath === 'root') return schemaDir

  const moduleName = /^modules\/([^/]+)$/u.exec(modulePath)?.[1]
  if (!moduleName) return modulePath

  const words = moduleName
    .replace(/([a-z\d])([A-Z])/gu, '$1 $2')
    .split(/[-_\s]+/u)
    .filter(Boolean)
  if (words.length === 0) return modulePath

  return words.map((word) => word[0]?.toLocaleUpperCase() + word.slice(1)).join(' ')
}

export function folderModules(bundle: StudioSchemaBundle, schemaDir = 'schema'): FolderModule[] {
  const members = collectClasses(bundle, schemaDir)
  const hues = topHueMap(members)
  const modules = new Map<string, FolderModule>()
  for (const value of members) {
    const selected = modules.get(value.modulePath) ?? {
      path: value.modulePath,
      label: moduleLabel(value.modulePath, schemaDir),
      hue: hues.get(value.modulePath) ?? 264,
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
  return moduleOfMember(bundle, 'class', className, schemaDir)
}
