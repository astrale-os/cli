/**
 * package-imports.ts — Node subpath-imports (`#alias`) resolution for authored
 * Domain sources.
 *
 * Studio must read a Domain that lives OUTSIDE its own module graph, and a
 * Bun-compiled standalone executable refuses to do that through the host
 * resolver: `Bun.resolveSync('#schema', <domainDir>)` answers the authored file
 * when Studio runs from source, but throws `Cannot find package '#schema'`
 * inside the shipped binary — the compiled runtime resolves against its own
 * embedded graph, not the Domain's package manifest. Discovery then dropped
 * every Domain whose Application imports its Schema through an alias.
 *
 * So Studio walks the manifest itself, following the Node resolution algorithm
 * for `imports`: identical answers from source and from the executable, with no
 * dependency on how the host runtime views the workspace.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/**
 * Conditions Studio activates when reading authored source. Bun applies
 * `bun`/`module`/`import`/`default` to a Domain importing its own subpath;
 * `source` and `development` are honoured too so a manifest that points tooling
 * at TypeScript keeps resolving to the authored file rather than a build output.
 */
const CONDITIONS = new Set(['bun', 'source', 'development', 'module', 'import', 'node', 'default'])

/** A `#alias` specifier — `#` and `#/` are reserved by the spec and never match. */
export function isPackageImportSpecifier(specifier: string): boolean {
  return specifier.startsWith('#') && specifier !== '#' && !specifier.startsWith('#/')
}

/**
 * Resolve `specifier` against the `imports` map of the package that owns
 * `fromDir`, returning every enabled target in preference order (relative
 * targets only — an alias onto an external package is not authored source).
 *
 * The paths are the manifest's own targets, NOT checked against disk: callers
 * own the extension policy, since a spec-compliant manifest points at the
 * emitted `./schema/index.js` while the authored file on disk is `index.ts`.
 */
export function resolvePackageImport(specifier: string, fromDir: string): string[] {
  if (!isPackageImportSpecifier(specifier)) return []
  const scope = packageScope(fromDir)
  if (scope === null) return []
  const target = matchImportsKey(specifier, scope.imports)
  if (target === null) return []
  return target.map((entry) => resolve(scope.dir, entry))
}

interface PackageScope {
  readonly dir: string
  readonly imports: Record<string, unknown>
}

/**
 * The nearest enclosing package manifest, exactly as Node's LOOKUP_PACKAGE_SCOPE
 * defines it: the FIRST package.json found walking up. A closer manifest without
 * an `imports` map shadows an outer one — the alias is genuinely unresolvable
 * then, and inventing a monorepo-wide fallback would resolve specifiers the
 * Domain's own runtime rejects.
 */
function packageScope(fromDir: string): PackageScope | null {
  let dir = resolve(fromDir)
  for (;;) {
    if (basename(dir) !== 'node_modules') {
      const manifest = join(dir, 'package.json')
      if (existsSync(manifest)) {
        const imports = readImports(manifest)
        return imports === null ? null : { dir, imports }
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function readImports(manifest: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const imports = (parsed as { imports?: unknown }).imports
  if (!imports || typeof imports !== 'object' || Array.isArray(imports)) return null
  return imports as Record<string, unknown>
}

/** Exact key first, then the most specific `*` pattern — Node's PATTERN_KEY_COMPARE. */
function matchImportsKey(specifier: string, imports: Record<string, unknown>): string[] | null {
  if (Object.hasOwn(imports, specifier)) {
    const targets = enabledTargets(imports[specifier], null)
    return targets.length > 0 ? targets : null
  }
  // Exactly one `*`, as the spec requires of a pattern key.
  const patterns = Object.keys(imports)
    .filter((key) => key.split('*').length === 2)
    .sort(byPatternSpecificity)
  for (const key of patterns) {
    const star = key.indexOf('*')
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue
    if (specifier.length < prefix.length + suffix.length) continue
    const match = specifier.slice(prefix.length, specifier.length - suffix.length)
    const targets = enabledTargets(imports[key], match)
    if (targets.length > 0) return targets
  }
  return null
}

/** Longest prefix wins; ties break on the longest suffix, as Node specifies. */
function byPatternSpecificity(a: string, b: string): number {
  const aStar = a.indexOf('*')
  const bStar = b.indexOf('*')
  return bStar - aStar || b.length - a.length
}

/**
 * Flatten a target into the relative paths this resolution enables. Conditional
 * objects are read in declaration order (the spec's precedence) and array
 * fallbacks are kept in order, so callers can take the first one on disk.
 */
function enabledTargets(target: unknown, match: string | null, depth = 0): string[] {
  if (depth > 8) return []
  if (typeof target === 'string') {
    const resolved = match === null ? target : target.replaceAll('*', match)
    return isValidTarget(resolved) ? [resolved] : []
  }
  if (Array.isArray(target)) {
    return target.flatMap((entry) => enabledTargets(entry, match, depth + 1))
  }
  if (!target || typeof target !== 'object') return []
  return Object.entries(target).flatMap(([condition, nested]) =>
    CONDITIONS.has(condition) ? enabledTargets(nested, match, depth + 1) : [],
  )
}

/**
 * The spec's valid-package-target rule: relative to the package, and never
 * climbing out of it or through `node_modules`. A target aliasing a bare package
 * is legal in a manifest but is not authored source, so it is not ours to hand
 * back either. Both are dropped rather than resolved, which also keeps a hostile
 * manifest from steering Studio at files outside the Domain.
 */
function isValidTarget(target: string): boolean {
  if (!target.startsWith('./') || target.includes('*')) return false
  return !target
    .split('/')
    .slice(1)
    .some((segment) => segment === '.' || segment === '..' || segment === 'node_modules')
}
