/**
 * Where each View's browser code starts: the module scripts of the document its route serves,
 * located through the frontend's Vite build. Read statically; nothing is built or executed, and
 * every place the reading cannot follow is returned as data.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Node, type SourceFile } from 'ts-morph'

import type { SourceGap } from '../../../../shared/contracts/schema'
import type { FrontendDeclaration } from './routes'

import { firstExisting, relToRoot, unwrapExpression } from '../../source-overlay/project'
import {
  addSource,
  callName,
  literalString,
  makeProject,
  objectProperty,
  objectValue,
  readTextSafe,
} from '../source'

/** A Vite `resolve.alias` entry: `replacement` is undefined when the reading cannot tell it. */
export interface ViteAlias {
  find: string | RegExp
  replacement?: string
}

/** One Vite build: how its modules resolve, and what of its config the reading cannot tell. */
export interface FrontendBuild {
  /** the config file, or the directory the build runs in when it has none */
  key: string
  /** the absolute Vite root documents and `/`-rooted sources resolve from */
  root: string
  aliases: readonly ViteAlias[]
  gaps: readonly SourceGap[]
}

/** Where a View's code starts, or why there is none, or why the reading cannot say. */
export type ViewEntry =
  | { kind: 'modules'; build: FrontendBuild; modules: string[]; inferred?: string }
  | { kind: 'none'; reason: string }
  | { kind: 'unread'; reason: string; file?: string; line?: number }

/** Config names Vite looks for in the directory it runs in, in its order. */
const VITE_CONFIGS = [
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.cjs',
  'vite.config.mts',
  'vite.config.cts',
]
/** Files of a workspace package that name the origin it is served from. */
const ORIGIN_FILES = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml', 'package.json']
/** How many directories above the Domain the reading looks for its workspace. */
const WORKSPACE_DEPTH = 4

interface Located {
  file?: string
  line?: number
}

type Unread = { kind: 'unread'; reason: string } & Located

interface ViteProject {
  build: FrontendBuild
}

/**
 * The entry of each named View. A Domain without a frontend serves no View code; a View
 * served by several frontends, or by one whose source the reading cannot tell, is unread.
 */
export function viewEntries(
  domainRoot: string,
  frontends: readonly FrontendDeclaration[],
  slugs: readonly string[],
): Map<string, ViewEntry> {
  const entries = new Map<string, ViewEntry>()
  if (frontends.length === 0) {
    for (const slug of slugs) {
      entries.set(slug, {
        kind: 'none',
        reason: 'The Domain declares no frontend: no code serves this View.',
      })
    }
    return entries
  }
  const at = (frontend: FrontendDeclaration): Located => ({
    file: relToRoot(domainRoot, frontend.file),
    line: frontend.line,
  })
  if (frontends.length > 1) {
    const [first] = frontends
    for (const slug of slugs) {
      entries.set(slug, {
        kind: 'unread',
        reason: `The Domain declares ${frontends.length} frontends; the reading cannot tell which one serves this View.`,
        ...(first ? at(first) : {}),
      })
    }
    return entries
  }
  const frontend = frontends[0]!
  const projects = new Map<string, ViteProject | Unread>()
  const projectOf = (cwd: string, config: string | undefined): ViteProject | Unread => {
    const key = `${cwd}\0${config ?? ''}`
    let project = projects.get(key)
    if (!project) {
      project = readViteProject(domainRoot, cwd, config)
      projects.set(key, project)
    }
    return project
  }

  const source = frontend.source
  let located: { project: ViteProject | Unread; inferred?: string } | Unread
  if (source.kind === 'vite') {
    located =
      source.config === null
        ? {
            kind: 'unread',
            reason: 'The frontend names a Vite config the reading cannot tell.',
            ...at(frontend),
          }
        : { project: projectOf(domainRoot, source.config) }
  } else if (source.kind === 'external') {
    located =
      source.origin === undefined
        ? {
            kind: 'unread',
            reason: 'The frontend is served from an external origin the reading cannot tell.',
            ...at(frontend),
          }
        : externalPackage(domainRoot, source.origin, at(frontend), projectOf)
  } else {
    located = {
      kind: 'unread',
      reason: 'The frontend declares a source the reading cannot tell.',
      ...at(frontend),
    }
  }

  for (const slug of slugs) {
    if ('kind' in located) {
      entries.set(slug, located)
      continue
    }
    const { project, inferred } = located
    if ('kind' in project) {
      entries.set(slug, project)
      continue
    }
    const document = frontend.routes.get(slug)?.document
    if (document === null) {
      entries.set(slug, {
        kind: 'unread',
        reason: 'The View’s route names a document the reading cannot tell.',
        ...at(frontend),
      })
      continue
    }
    const modules = documentModules(domainRoot, project, document ?? 'index.html', at(frontend))
    entries.set(
      slug,
      'kind' in modules
        ? modules
        : {
            kind: 'modules',
            build: {
              ...project.build,
              gaps: [...project.build.gaps, ...modules.gaps],
            },
            modules: modules.files,
            ...(inferred ? { inferred } : {}),
          },
    )
  }
  return entries
}

/** The module scripts a document loads, as Vite resolves their sources from its root. */
function documentModules(
  domainRoot: string,
  project: ViteProject,
  document: string,
  declared: Located,
): { files: string[]; gaps: SourceGap[] } | Unread {
  const file = resolve(project.build.root, document)
  const shown = relToRoot(domainRoot, file)
  if (!isFile(file)) {
    return {
      kind: 'unread',
      reason: `The View’s document \`${shown}\` does not exist.`,
      ...declared,
    }
  }
  const html = readTextSafe(file)
  const files: string[] = []
  const gaps: SourceGap[] = []
  for (const script of html.matchAll(/<script\b([^>]*)>/giu)) {
    const attributes = script[1] ?? ''
    if (attribute(attributes, 'type') !== 'module') continue
    const line = html.slice(0, script.index).split('\n').length
    const src = attribute(attributes, 'src')
    if (src === undefined) {
      gaps.push({
        file: shown,
        line,
        reason: 'runs an inline module script the reading does not read',
      })
      continue
    }
    if (/^[a-z][a-z0-9+.-]*:/iu.test(src) || src.startsWith('//')) continue
    const path = src.replace(/[?#].*$/u, '')
    const target = path.startsWith('/')
      ? join(project.build.root, path)
      : resolve(dirname(file), path)
    const module = firstExisting(target)
    if (module) files.push(module)
    else gaps.push({ file: shown, line, reason: `loads \`${src}\`, which the reading cannot find` })
  }
  if (files.length === 0) {
    return {
      kind: 'unread',
      reason:
        gaps.length > 0
          ? `The document \`${shown}\` loads no module script the reading can find.`
          : `The document \`${shown}\` loads no module script.`,
      file: shown,
      line: gaps[0]?.line ?? 1,
    }
  }
  return { files, gaps }
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    'iu',
  ).exec(attributes)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

/**
 * The workspace package serving an external origin: the one package of the Domain's workspace,
 * other than the Domain, whose deployment or package files name the origin's host. An inference
 * the result states; none or several matches leave the View unread.
 */
function externalPackage(
  domainRoot: string,
  origin: string,
  declared: Located,
  projectOf: (cwd: string, config: string | undefined) => ViteProject | Unread,
): { project: ViteProject | Unread; inferred: string } | Unread {
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return {
      kind: 'unread',
      reason: `The frontend's external origin \`${origin}\` is no URL.`,
      ...declared,
    }
  }
  const workspace = enclosingWorkspace(domainRoot)
  if (!workspace) {
    return {
      kind: 'unread',
      reason: `The View is served from ${origin}; the reading finds no workspace around the Domain to look for its code in.`,
      ...declared,
    }
  }
  const matches: Array<{ dir: string; file: string }> = []
  for (const dir of workspace.packages) {
    if (relToRoot(domainRoot, dir) === '') continue
    const named = [...ORIGIN_FILES, ...VITE_CONFIGS].find((name) =>
      namesHost(readTextSafe(join(dir, name)), host),
    )
    if (named) matches.push({ dir, file: named })
  }
  if (matches.length !== 1) {
    const listed = matches.map((match) => `\`${relToRoot(domainRoot, match.dir)}\``).join(', ')
    return {
      kind: 'unread',
      reason:
        matches.length === 0
          ? `The View is served from ${origin}; no package of the workspace names that host.`
          : `The View is served from ${origin}; several packages of the workspace name that host: ${listed}.`,
      ...declared,
    }
  }
  const [match] = matches as [{ dir: string; file: string }]
  const shown = relToRoot(domainRoot, match.dir)
  return {
    project: projectOf(match.dir, undefined),
    inferred: `The View is served from ${origin}; its code is read from the workspace package \`${shown}\`, whose \`${match.file}\` names that host.`,
  }
}

function namesHost(text: string, host: string): boolean {
  if (!text) return false
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9.-])${escaped}(?![A-Za-z0-9-]|\\.[A-Za-z0-9])`, 'u').test(text)
}

/** The nearest workspace enclosing the Domain, and its package directories that exist. */
function enclosingWorkspace(domainRoot: string): { root: string; packages: string[] } | undefined {
  let dir = resolve(domainRoot)
  for (let depth = 0; depth <= WORKSPACE_DEPTH; depth += 1) {
    const patterns = workspacePatterns(dir)
    if (patterns) return { root: dir, packages: expandPatterns(dir, patterns) }
    if (existsSync(join(dir, '.git'))) return undefined
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

/** The package patterns of `pnpm-workspace.yaml`, or of `package.json` `workspaces`. */
function workspacePatterns(dir: string): string[] | undefined {
  const yaml = readTextSafe(join(dir, 'pnpm-workspace.yaml'))
  if (yaml) {
    const block = /^packages:\s*\n((?:[ \t]+-.*\n?|[ \t]*#.*\n?|[ \t]*\n)*)/mu.exec(yaml)?.[1] ?? ''
    return [...block.matchAll(/^[ \t]+-[ \t]*['"]?([^'"#\n]+?)['"]?[ \t]*(?:#.*)?$/gmu)].map(
      (match) => match[1]!,
    )
  }
  const manifest = readTextSafe(join(dir, 'package.json'))
  if (!manifest) return undefined
  try {
    const workspaces = (JSON.parse(manifest) as { workspaces?: unknown }).workspaces
    const list = Array.isArray(workspaces)
      ? workspaces
      : (workspaces as { packages?: unknown } | undefined)?.packages
    return Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string')
      : undefined
  } catch {
    return undefined
  }
}

/** Package directories a workspace's patterns name: exact directories and `dir/*` globs. */
function expandPatterns(root: string, patterns: readonly string[]): string[] {
  const packages = new Set<string>()
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue
    const clean = pattern.replace(/\/+$/u, '')
    const glob = /^(.*?)\/\*{1,2}$/u.exec(clean)
    if (glob) {
      const parent = join(root, glob[1] ?? '')
      for (const entry of safeEntries(parent)) {
        if (isDirectory(join(parent, entry))) packages.add(join(parent, entry))
      }
    } else if (!clean.includes('*') && isDirectory(join(root, clean))) {
      packages.add(join(root, clean))
    }
  }
  return [...packages].filter((dir) => isFile(join(dir, 'package.json'))).sort()
}

/**
 * A Vite build as its config states it: the root it resolves from and its aliases. A build run
 * in `cwd` reads `config`, or the first config Vite looks for there; with none it keeps Vite's
 * defaults.
 */
function readViteProject(
  domainRoot: string,
  cwd: string,
  config: string | undefined,
): ViteProject | Unread {
  const file =
    config === undefined
      ? VITE_CONFIGS.map((name) => join(cwd, name)).find(isFile)
      : resolve(cwd, config)
  if (file === undefined) return { build: { key: cwd, root: cwd, aliases: [], gaps: [] } }
  const shown = relToRoot(domainRoot, file)
  if (!isFile(file)) {
    return {
      kind: 'unread',
      reason: `The frontend's Vite config \`${shown}\` does not exist.`,
      file: shown,
      line: 1,
    }
  }
  const source = addSource(makeProject(), file)
  const options = source ? configObject(source) : null
  if (!source || !options) {
    return {
      kind: 'unread',
      reason: `The Vite config \`${shown}\` exports a value the reading cannot tell.`,
      file: shown,
      line: 1,
    }
  }
  const configDir = dirname(file)
  const rootValue = objectProperty(options, 'root', source)
  const root = rootValue ? pathValue(rootValue, source, configDir, cwd) : '.'
  if (root === undefined) {
    return {
      kind: 'unread',
      reason: 'The Vite config sets `root` to a value the reading cannot tell.',
      file: shown,
      line: rootValue!.getStartLineNumber(),
    }
  }
  const gaps: SourceGap[] = []
  const aliases = viteAliases(options, source, configDir, cwd, (node) =>
    gaps.push({
      file: shown,
      line: node.getStartLineNumber(),
      reason: 'declares a Vite alias the reading cannot tell',
    }),
  )
  return { build: { key: file, root: resolve(cwd, root), aliases, gaps } }
}

/** The options object a Vite config exports: `defineConfig({…})`, `{…}`, or a function returning one. */
function configObject(source: SourceFile): Node | null {
  const assignment = source.getExportAssignment((candidate) => !candidate.isExportEquals())
  let value: Node | undefined = assignment?.getExpression()
  for (let depth = 0; value && depth < 4; depth += 1) {
    const object = objectValue(value, source)
    if (object) return object
    const unwrapped = unwrapExpression(value)
    if (Node.isIdentifier(unwrapped)) {
      value = source.getVariableDeclaration(unwrapped.getText())?.getInitializer()
    } else if (Node.isCallExpression(unwrapped) && callName(unwrapped) === 'defineConfig') {
      value = unwrapped.getArguments()[0]
    } else if (Node.isArrowFunction(unwrapped) || Node.isFunctionExpression(unwrapped)) {
      const body = unwrapped.getBody()
      value = Node.isBlock(body)
        ? body.getStatements().find(Node.isReturnStatement)?.getExpression()
        : body
    } else return null
  }
  return null
}

function viteAliases(
  options: Node,
  source: SourceFile,
  configDir: string,
  cwd: string,
  unknown: (node: Node) => void,
): ViteAlias[] {
  const resolveOptions = objectValue(
    objectProperty(options, 'resolve', source) ?? undefined,
    source,
  )
  const alias = resolveOptions ? objectProperty(resolveOptions, 'alias', source) : null
  if (!alias) return []
  const aliases: ViteAlias[] = []
  const add = (find: string | RegExp | undefined, replacement: Node | undefined, at: Node) => {
    if (find === undefined) return unknown(at)
    const target = replacement ? pathValue(replacement, source, configDir, cwd) : undefined
    if (target === undefined) unknown(at)
    aliases.push(target === undefined ? { find } : { find, replacement: target })
  }
  const value = unwrapExpression(alias)
  if (Node.isArrayLiteralExpression(value)) {
    for (const element of value.getElements()) {
      const entry = objectValue(element, source)
      if (!entry) {
        unknown(element)
        continue
      }
      const find = objectProperty(entry, 'find', source)
      add(
        find ? patternValue(find, source) : undefined,
        objectProperty(entry, 'replacement', source) ?? undefined,
        element,
      )
    }
  } else if (Node.isObjectLiteralExpression(value)) {
    for (const property of value.getProperties()) {
      if (!Node.isPropertyAssignment(property)) {
        unknown(property)
        continue
      }
      const name = property.getNameNode()
      const find =
        Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name)
          ? name.getLiteralValue()
          : Node.isIdentifier(name)
            ? name.getText()
            : undefined
      add(find, property.getInitializer(), property)
    }
  } else unknown(alias)
  return aliases
}

function patternValue(node: Node, source: SourceFile): string | RegExp | undefined {
  const value = unwrapExpression(node)
  if (Node.isRegularExpressionLiteral(value)) {
    try {
      return value.getLiteralValue()
    } catch {
      return undefined
    }
  }
  return literalString(value, source)
}

/**
 * A path a config writes: a string as written, or an absolute path from `import.meta.url`,
 * `__dirname`, `import.meta.dirname` or `process.cwd()` joined with literal segments. Undefined
 * for anything else.
 */
function pathValue(
  node: Node,
  source: SourceFile,
  configDir: string,
  cwd: string,
): string | undefined {
  const value = unwrapExpression(node)
  const text = literalString(value, source)
  if (text !== undefined) return text
  if (Node.isCallExpression(value)) {
    const name = callName(value)
    const args = value.getArguments()
    if (name === 'fileURLToPath' && args.length === 1) {
      const url = unwrapExpression(args[0]!)
      if (Node.isNewExpression(url) && url.getExpression().getText() === 'URL') {
        const [relative, base] = url.getArguments()
        const path = relative ? literalString(relative, source) : undefined
        // A URL keeps the trailing slash of a directory, which an alias replacement relies on.
        if (path !== undefined && base?.getText() === 'import.meta.url') {
          const resolved = resolve(configDir, path)
          return path.endsWith('/') ? `${resolved}/` : resolved
        }
      }
      return undefined
    }
    if (name === 'resolve' || name === 'join') {
      const [first, ...rest] = args
      if (!first) return undefined
      const base = anchor(first, configDir, cwd)
      const segments = (base === undefined ? args : rest).map((arg) => literalString(arg, source))
      if (segments.some((segment) => segment === undefined)) return undefined
      const parts = segments as string[]
      if (base !== undefined) return resolve(base, ...parts)
      return name === 'resolve' ? resolve(cwd, ...parts) : join(...parts)
    }
  }
  return anchor(value, configDir, cwd)
}

function anchor(node: Node, configDir: string, cwd: string): string | undefined {
  const text = unwrapExpression(node).getText()
  if (text === '__dirname' || text === 'import.meta.dirname') return configDir
  if (text === 'process.cwd()') return cwd
  return undefined
}

/** The specifier an alias gives `specifier`, as Vite's alias plugin rewrites it. */
export function aliased(
  specifier: string,
  aliases: readonly ViteAlias[],
): (ViteAlias & { result?: string }) | undefined {
  for (const alias of aliases) {
    if (typeof alias.find === 'string') {
      if (specifier !== alias.find && !specifier.startsWith(`${alias.find}/`)) continue
      return alias.replacement === undefined
        ? alias
        : { ...alias, result: alias.replacement + specifier.slice(alias.find.length) }
    }
    const pattern = new RegExp(alias.find.source, alias.find.flags.replace('g', ''))
    if (!pattern.test(specifier)) continue
    return alias.replacement === undefined
      ? alias
      : { ...alias, result: specifier.replace(pattern, alias.replacement) }
  }
  return undefined
}

function safeEntries(dir: string): string[] {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return isAbsolute(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}
