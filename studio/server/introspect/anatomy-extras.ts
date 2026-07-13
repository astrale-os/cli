/**
 * anatomy-extras.ts — views / functions / client tree / env fields extraction.
 *
 * Pure static parsing only — domain TS is NEVER executed. Views/functions are
 * read off their `index.ts` registries (slug → defineView/identifier); the
 * client tree is a shallow readdir + best-effort ROUTES parse; env fields come
 * from a ts-morph pass over the exported `Env` interface. Every entry point is
 * defensive: missing files/dirs yield safe empties, never throws.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { InterfaceDeclaration, Node, Project, SyntaxKind } from 'ts-morph'

import type { ClientTree, EnvField, ViewInfo } from '../../shared/types'

// ───────────────────────────── small fs helpers ─────────────────────────────

function readTextSafe(file: string): string {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  } catch {
    return ''
  }
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((e) => {
        try {
          return statSync(join(dir, e)).isFile()
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return []
  }
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((e) => {
        try {
          return statSync(join(dir, e)).isDirectory()
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return []
  }
}

/** A throwaway in-memory ts-morph project (no tsconfig, no type-checking IO). */
function makeProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: { allowJs: true },
  })
}

/** Strip the leading-JSDoc decorations to a single trimmed line of prose. */
function cleanDoc(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const text = raw
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim()
    .replace(/\s*\n\s*/g, ' ')
    .trim()
  return text.length ? text : undefined
}

// ──────────────────────────────── 1) views ────────────────────────────────

/**
 * Resolve the relative `./welcome` / `../foo` import spec used in views/index.ts
 * to an on-disk `.ts` file under the views dir. Returns absolute path or null.
 */
function resolveLocalModule(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = join(dirname(fromFile), spec)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c
    } catch {
      /* ignore */
    }
  }
  return null
}

export function buildViews(root: string): ViewInfo[] {
  const indexFile = join(root, 'views', 'index.ts')
  if (!existsSync(indexFile)) return []

  let project: Project
  let index
  try {
    project = makeProject()
    index = project.addSourceFileAtPath(indexFile)
  } catch {
    return []
  }

  // Map identifier name → imported module spec (e.g. `welcome` → './welcome').
  const importSpecByName = new Map<string, string>()
  for (const imp of index.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    for (const named of imp.getNamedImports()) {
      importSpecByName.set(named.getAliasNode()?.getText() ?? named.getName(), spec)
    }
    const def = imp.getDefaultImport()
    if (def) importSpecByName.set(def.getText(), spec)
  }

  // Find the exported `views` object literal: { welcome, 'ui-status-page': statusPage }.
  const viewsDecl =
    index.getVariableDeclaration('views') ??
    index.getVariableDeclarations().find((d) => d.getName() === 'views')
  const init = viewsDecl?.getInitializer()
  if (!init || !Node.isObjectLiteralExpression(init)) return []

  const views: ViewInfo[] = []
  for (const prop of init.getProperties()) {
    let slug: string | undefined
    let refName: string | undefined
    let inlineArg: Node | undefined // `slug: defineView({...})` declared right here (e.g. mcac)

    if (Node.isShorthandPropertyAssignment(prop)) {
      // `welcome,` → slug `welcome`, ref `welcome` (imported view file)
      slug = prop.getName()
      refName = prop.getName()
    } else if (Node.isPropertyAssignment(prop)) {
      const nameNode = prop.getNameNode()
      slug = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : prop.getName()
      const valueInit = prop.getInitializer()
      if (
        valueInit &&
        Node.isCallExpression(valueInit) &&
        valueInit.getExpression().getText() === 'defineView'
      ) {
        // `'ui-move': defineView({...})` — parsed in place
        inlineArg = valueInit.getArguments()[0]
      } else if (valueInit && Node.isIdentifier(valueInit)) {
        // `'ui-status-page': statusPage` — resolved from an imported file
        refName = valueInit.getText()
      }
    }

    if (!slug) continue

    const info: ViewInfo = { slug, kind: 'unknown', url: undefined }

    if (inlineArg) {
      // inline defineView (e.g. mcac) — the declaration lives in views/index.ts itself
      info.file = relative(root, indexFile)
      applyParsed(info, parseViewObject(inlineArg))
    } else {
      // A shorthand may reference a defineView declared earlier in this same
      // registry file (services), or one imported from another module (ai-gateway).
      const localInit = refName
        ? index.getVariableDeclaration(refName)?.getInitializer()
        : undefined
      if (
        localInit &&
        Node.isCallExpression(localInit) &&
        localInit.getExpression().getText() === 'defineView'
      ) {
        const arg = localInit.getArguments()[0]
        if (arg) {
          info.file = relative(root, indexFile)
          applyParsed(info, parseViewObject(arg))
        }
      } else {
        const spec = refName ? importSpecByName.get(refName) : undefined
        const viewFile = spec ? resolveLocalModule(indexFile, spec) : null
        if (viewFile) {
          info.file = relative(root, viewFile)
          try {
            applyParsed(info, parseViewFile(project, viewFile))
          } catch {
            /* keep the unknown-kind stub */
          }
        }
      }
    }

    views.push(info)
  }

  return views
}

interface ParsedView {
  kind: ViewInfo['kind']
  auth?: string
  mount?: string
  viewFor?: string | string[]
  description?: string
}

/** Copy a ParsedView's set fields onto a ViewInfo. */
function applyParsed(info: ViewInfo, parsed: ParsedView): void {
  info.kind = parsed.kind
  if (parsed.auth !== undefined) info.auth = parsed.auth
  if (parsed.mount !== undefined) info.mount = parsed.mount
  if (parsed.viewFor !== undefined) info.viewFor = parsed.viewFor
  if (parsed.description !== undefined) info.description = parsed.description
}

/** Parse a referenced view module: find its defineView({...}) call + parse the literal. */
function parseViewFile(project: Project, file: string): ParsedView {
  const sf = project.addSourceFileAtPathIfExists(file) ?? project.addSourceFileAtPath(file)
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() === 'defineView') {
      const arg = call.getArguments()[0]
      if (arg) return parseViewObject(arg)
    }
  }
  return { kind: 'unknown' }
}

/** Parse a `defineView({...})` object-literal argument into a ParsedView. */
function parseViewObject(arg: Node): ParsedView {
  const result: ParsedView = { kind: 'unknown' }
  if (!Node.isObjectLiteralExpression(arg)) return result

  let hasRender = false
  let hasInlineHtml = false
  let hasMount = false

  for (const prop of arg.getProperties()) {
    if (
      !Node.isPropertyAssignment(prop) &&
      !Node.isMethodDeclaration(prop) &&
      !Node.isShorthandPropertyAssignment(prop)
    ) {
      continue
    }
    const key = prop.getName?.()
    if (!key) continue

    if (key === 'auth') {
      if (Node.isPropertyAssignment(prop)) {
        const v = prop.getInitializer()
        if (v && Node.isStringLiteral(v)) result.auth = v.getLiteralValue()
        else if (v) result.auth = v.getText().replace(/^['"`]|['"`]$/g, '')
      }
    } else if (key === 'mount') {
      hasMount = true
      if (Node.isPropertyAssignment(prop)) {
        const v = prop.getInitializer()
        if (v && Node.isStringLiteral(v)) result.mount = v.getLiteralValue()
        else if (v) result.mount = v.getText().replace(/^['"`]|['"`]$/g, '')
      }
    } else if (key === 'render') {
      hasRender = true
      // Inline HTML if the render body references c.html(...) or returns an HTML string.
      const text = prop.getText()
      if (/\bc\s*\.\s*html\s*\(/.test(text) || /<!doctype html>|<html\b/i.test(text)) {
        hasInlineHtml = true
      }
    } else if (key === 'viewFor') {
      if (Node.isPropertyAssignment(prop)) {
        const v = prop.getInitializer()
        if (v) {
          // selfOf(A) → 'A' ; [selfOf(A), selfOf(B)] → ['A','B'] ; else best-effort identifier.
          const names = [...v.getText().matchAll(/selfOf\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)].map(
            (m) => m[1],
          )
          if (names.length > 1) result.viewFor = names
          else if (names.length === 1) result.viewFor = names[0]
          else if (Node.isIdentifier(v)) result.viewFor = v.getText()
        }
      }
    } else if (key === 'description') {
      if (Node.isPropertyAssignment(prop)) {
        const v = prop.getInitializer()
        if (v && Node.isStringLiteral(v)) result.description = v.getLiteralValue()
      }
    }
  }

  if (hasRender && (hasInlineHtml || !hasMount)) result.kind = 'inline-html'
  else if (hasMount) result.kind = 'spa'
  else result.kind = 'unknown'

  return result
}

// ───────────────────────────── 2) client tree ─────────────────────────────

const RESERVED_CLIENT_DIRS = new Set(['shell', 'ui', 'views'])

export function buildClientTree(
  root: string,
  clientDir: string | null = join(root, 'client'),
): ClientTree {
  const srcDir = clientDir ? join(clientDir, 'src') : ''
  if (!existsSync(srcDir)) {
    return { shell: [], features: [], routes: {}, present: false }
  }

  const shell = listFiles(join(srcDir, 'shell'))

  const features = listDirs(srcDir)
    .filter((d) => !RESERVED_CLIENT_DIRS.has(d))
    .map((name) => ({ name, files: listFiles(join(srcDir, name)) }))

  const routes = parseRoutes(
    listFiles(srcDir)
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
      .map((file) => join(srcDir, file)),
  )

  return { shell, features, routes, present: true }
}

/**
 * Best-effort parse of top-level client route registries. Domains call these
 * maps ROUTES, VIEW_REGISTRY, or another local name; the stable contract is a
 * quoted `/ui/…` key pointing at a component identifier.
 */
function parseRoutes(files: string[]): Record<string, string> {
  const routes: Record<string, string> = {}
  for (const file of files) {
    const src = readTextSafe(file)
    const entryRe = /['"`](\/ui\/[^'"`]+)['"`]\s*:\s*([A-Za-z_$][\w$.]*)/g
    let match: RegExpExecArray | null
    while ((match = entryRe.exec(src)) !== null) {
      routes[match[1]] = match[2]
    }
  }
  return routes
}

// ───────────────────────────── 3) env fields ──────────────────────────────

const KNOWN_INFRA_FIELDS = new Set(['WORKER_URL', 'ASSETS', 'SELF', 'VIEW_DEV_URL'])

export function buildEnvFields(root: string): EnvField[] {
  const envFile = join(root, 'env.ts')
  if (!existsSync(envFile)) return []

  let project: Project
  let sf
  try {
    project = makeProject()
    sf = project.addSourceFileAtPath(envFile)
  } catch {
    return []
  }

  const iface: InterfaceDeclaration | undefined =
    sf.getInterface('Env') ?? sf.getInterfaces().find((i) => i.getName() === 'Env')
  if (!iface) return []

  const fields: EnvField[] = []
  for (const member of iface.getMembers()) {
    // Skip index signatures: `[key: string]: unknown`.
    if (Node.isIndexSignatureDeclaration(member)) continue
    if (!Node.isPropertySignature(member)) continue

    const name = member.getName()
    if (!name) continue

    const optional = member.hasQuestionToken()
    const doc = cleanDoc(member.getJsDocs()[0]?.getInnerText())

    const isInfra = KNOWN_INFRA_FIELDS.has(name)
    const secret = !isInfra

    const field: EnvField = { name, optional, secret }
    if (doc) field.doc = doc
    fields.push(field)
  }

  return fields
}
