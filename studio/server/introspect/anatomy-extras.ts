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
      importSpecByName.set(named.getName(), spec)
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
      // referenced view file (e.g. my-domain) — resolve the import + parse the file
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

export function buildClientTree(root: string): ClientTree {
  const srcDir = join(root, 'client', 'src')
  if (!existsSync(srcDir)) {
    return { shell: [], features: [], routes: {}, present: false }
  }

  const shell = listFiles(join(srcDir, 'shell'))

  const features = listDirs(srcDir)
    .filter((d) => !RESERVED_CLIENT_DIRS.has(d))
    .map((name) => ({ name, files: listFiles(join(srcDir, name)) }))

  const routes = parseRoutes(join(srcDir, 'app.tsx'))

  return { shell, features, routes, present: true }
}

/** Best-effort parse of the `ROUTES` map (mountPath → ComponentName) in app.tsx. */
function parseRoutes(appFile: string): Record<string, string> {
  const routes: Record<string, string> = {}
  const src = readTextSafe(appFile)
  if (!src) return routes

  // Isolate the ROUTES object literal body: `const ROUTES[: Type] = { ... }`.
  // The identifier may carry a type annotation but never a newline/backtick — that
  // keeps us from latching onto a `ROUTES` mention inside a JSDoc comment.
  const startMatch = src.match(/\bROUTES\b\s*(?::\s*[\w<>.\[\], ]+)?\s*=\s*\{/)
  if (!startMatch || startMatch.index === undefined) {
    return routes
  }
  const openIdx = src.indexOf('{', startMatch.index + startMatch[0].length - 1)
  if (openIdx === -1) return routes

  // Balance braces to find the matching close.
  let depth = 0
  let endIdx = -1
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }
  if (endIdx === -1) return routes

  const body = src.slice(openIdx + 1, endIdx)
  // Each entry:  '/ui/status-page': StatusView   (quoted key → identifier/expr).
  const entryRe = /['"`]([^'"`]+)['"`]\s*:\s*([A-Za-z_$][\w$.]*)/g
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(body)) !== null) {
    routes[m[1]] = m[2]
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
