/** SDK V1 project discovery and the in-process Studio registry. */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

export interface DomainHandle {
  readonly id: string
  readonly root: string
  readonly configFile: string
  readonly applicationFile: string
  readonly schemaDirName: string
  readonly schemaDir: string
  readonly schemaIndex: string
  origin?: string
}

const registry = new Map<string, DomainHandle>()

export function makeId(root: string): string {
  return basename(resolve(root)).replace(/[^a-zA-Z0-9_-]/g, '-') || 'domain'
}

/** Resolve the Application imported by config, with root application.ts as convention. */
export function resolveApplicationEntry(root: string): string | null {
  const project = resolve(root)
  const conventional = join(project, 'application.ts')
  if (existsSync(conventional)) return conventional
  const config = join(project, 'astrale.config.ts')
  if (!existsSync(config)) return null
  let source: string
  try {
    source = readFileSync(config, 'utf8')
  } catch {
    return null
  }
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)) {
    const specifier = match[1]
    if (
      !specifier?.startsWith('.') ||
      basename(specifier).replace(/\.[^.]+$/u, '') !== 'application'
    ) {
      continue
    }
    const selected = resolveSourceFile(project, specifier)
    if (selected !== null) return selected
  }
  return null
}

/** Resolve schema.ts or schema/index.ts beside the Application, then at project root. */
export function resolveSchemaEntry(
  root: string,
  applicationFile: string,
  schemaDirName = 'schema',
): string | null {
  const project = resolve(root)
  const applicationDir = dirname(applicationFile)
  const candidates = [
    join(applicationDir, 'schema.ts'),
    join(applicationDir, schemaDirName, 'index.ts'),
    join(project, 'schema.ts'),
    join(project, schemaDirName, 'index.ts'),
  ]
  return [...new Set(candidates)].find(existsSync) ?? null
}

export function isDomainDir(root: string, schemaDirName = 'schema'): boolean {
  const project = resolve(root)
  if (!existsSync(join(project, 'astrale.config.ts'))) return false
  const application = resolveApplicationEntry(project)
  return application !== null && resolveSchemaEntry(project, application, schemaDirName) !== null
}

export function registerDomain(root: string, schemaDirName = 'schema'): DomainHandle | null {
  const project = resolve(root)
  const applicationFile = resolveApplicationEntry(project)
  if (applicationFile === null || !existsSync(join(project, 'astrale.config.ts'))) return null
  const schemaIndex = resolveSchemaEntry(project, applicationFile, schemaDirName)
  if (schemaIndex === null) return null
  const schemaDir = dirname(schemaIndex)
  const handle: DomainHandle = {
    id: makeId(project),
    root: project,
    configFile: join(project, 'astrale.config.ts'),
    applicationFile,
    schemaDirName: relative(project, schemaDir).replaceAll('\\', '/') || '.',
    schemaDir,
    schemaIndex,
  }
  registry.set(handle.id, handle)
  return handle
}

export function unregisterDomain(id: string): void {
  registry.delete(id)
}

export function getDomain(id: string): DomainHandle | undefined {
  return registry.get(id)
}

export function allDomains(): DomainHandle[] {
  return [...registry.values()]
}

/** Studio's current project model always requires the semantic SDK Schema facade. */
export function depsInstalled(root: string): boolean {
  if (existsSync(join(root, 'node_modules', '@astrale-os', 'sdk'))) return true
  try {
    Bun.resolveSync('@astrale-os/sdk/schema', root)
    return true
  } catch {
    return false
  }
}

function resolveSourceFile(root: string, specifier: string): string | null {
  const absolute = resolve(root, specifier)
  const extension = extname(absolute)
  const candidates =
    extension === ''
      ? [`${absolute}.ts`, join(absolute, 'index.ts')]
      : [absolute, `${absolute.slice(0, -extension.length)}.ts`]
  return candidates.find(existsSync) ?? null
}
