/**
 * Shared helpers for domain scaffolding: filtered recursive copy + token
 * rename engine.
 *
 * Used by the Cloudflare DomainPlatform adapter's `scaffold()` to turn
 * `cli/templates/<template>/` into `<targetDir>/` without any manual edit.
 */

import type { JWK } from 'jose'

import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { generateEd25519Jwk } from './keys'

/** Paths that must never be copied into the new domain dir. */
const DEFAULT_EXCLUDES = [
  'node_modules',
  '.wrangler',
  '.dev.vars',
  'dist',
  'spec.json',
  'private-key.json',
]

/** File extensions treated as binary (content never rewritten). */
const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
])

/** Flat literal substitutions applied in order. */
export type RenameMap = Array<{ from: string; to: string }>

/**
 * Derive PascalCase/camelCase variants from a kebab-case slug.
 * `my-cool-domain` → { pascal: 'MyCoolDomain', camel: 'myCoolDomain', upper: 'MY_COOL_DOMAIN' }.
 */
export function slugVariants(slug: string): {
  kebab: string
  pascal: string
  camel: string
  upperSnake: string
} {
  const parts = slug.split('-').filter(Boolean)
  const pascal = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join('')
  const camel = pascal[0]!.toLowerCase() + pascal.slice(1)
  const upperSnake = parts.join('_').toUpperCase()
  return { kebab: slug, pascal, camel, upperSnake }
}

/**
 * Build the rename map applied to every scaffold template.
 *
 * All templates use the same placeholder stem `astrale-domain` so a single
 * builder handles all of them; adding a new template under
 * `cli/templates/<name>/` requires zero changes here. Specific FQDNs precede
 * the bare-kebab rule so `astrale-domain.test.astrale.ai` isn't first mangled
 * to `<kebab>.test.astrale.ai` by the catch-all.
 */
export function buildScaffoldRenameMap(slug: string): RenameMap {
  const v = slugVariants(slug)
  return [
    // PascalCase / camelCase identifiers.
    { from: 'AstraleDomainSchema', to: `${v.pascal}Schema` },
    { from: 'astraleDomainDef', to: `${v.camel}Def` },
    // FQDNs (precede the bare-kebab catch-all).
    { from: 'astrale-domain.test.astrale.ai', to: `${v.kebab}.test.astrale.ai` },
    { from: 'astrale-domain.astrale.ai', to: `${v.kebab}.astrale.ai` },
    { from: 'astrale-domain.localhost', to: `${v.kebab}.localhost` },
    // Env-var prefix.
    { from: 'ASTRALE_DOMAIN_', to: `${v.upperSnake}_` },
    // Catch-all: folder names, package names, prose, ClassPath strings.
    { from: 'astrale-domain', to: v.kebab },
  ]
}

/** Filter predicate used by fs.cp. */
function makeFilter(rootSrc: string): (src: string) => boolean {
  return (src: string) => {
    const rel = relative(rootSrc, src)
    if (!rel) return true
    for (const ex of DEFAULT_EXCLUDES) {
      if (rel === ex || rel.startsWith(`${ex}/`) || rel.endsWith(`/${ex}`)) return false
    }
    return true
  }
}

/**
 * Recursively copy `srcDir` → `destDir`, skipping default-excluded paths.
 * Overwrites existing files in `destDir`.
 */
export async function copyTemplate(srcDir: string, destDir: string): Promise<void> {
  await cp(srcDir, destDir, {
    recursive: true,
    errorOnExist: false,
    force: true,
    filter: makeFilter(srcDir),
  })
}

/** Apply a rename map to the text content of a single file. */
export function applyRenameToText(text: string, map: RenameMap): string {
  let out = text
  for (const { from, to } of map) {
    if (out.includes(from)) out = out.split(from).join(to)
  }
  return out
}

function isBinaryPath(path: string): boolean {
  const idx = path.lastIndexOf('.')
  if (idx < 0) return false
  return BINARY_EXT.has(path.slice(idx).toLowerCase())
}

/**
 * Walk `rootDir` and rewrite every text file's content through the rename
 * map. Skips binaries, node_modules, and other default-excluded paths.
 */
export async function rewriteFilesContent(rootDir: string, map: RenameMap): Promise<number> {
  let touched = 0
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (DEFAULT_EXCLUDES.includes(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        if (isBinaryPath(full)) continue
        const before = await readFile(full, 'utf-8')
        const after = applyRenameToText(before, map)
        if (after !== before) {
          await writeFile(full, after)
          touched++
        }
      }
    }
  }
  await walk(rootDir)
  return touched
}

/**
 * Rename files/dirs whose paths contain any literal `from` token.
 * Runs bottom-up so renaming a parent dir doesn't invalidate child paths.
 */
export async function renameFilesInTree(rootDir: string, map: RenameMap): Promise<number> {
  let renamed = 0
  async function collect(dir: string, acc: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (DEFAULT_EXCLUDES.includes(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await collect(full, acc)
      acc.push(full)
    }
  }
  const all: string[] = []
  await collect(rootDir, all)
  // Sort by depth desc so we rename leaves before parents.
  all.sort((a, b) => b.split('/').length - a.split('/').length)
  for (const path of all) {
    const base = path.slice(dirname(path).length + 1)
    let newBase = base
    for (const { from, to } of map) {
      if (newBase.includes(from)) newBase = newBase.split(from).join(to)
    }
    if (newBase !== base) {
      const next = join(dirname(path), newBase)
      await rename(path, next)
      renamed++
    }
  }
  return renamed
}

/**
 * Overwrite `worker/src/keys.ts` with a freshly-generated Ed25519 pair AND
 * mirror the private JWK to `worker/keys/<slug>.localhost-worker.jwk.json`
 * so `astrale instance install` can auto-detect it (the auto-detect path
 * looks for `<baseDomain>-worker.jwk.json`, and the local:inprocess preset's
 * baseDomain is `<slug>.localhost`). Without the mirror the worker has a
 * key but install can't find it — every freshly-scaffolded domain wedged
 * at "No -k provided and no worker key auto-detected".
 *
 * Called after the scaffold copy + rename so the domain never ships the
 * template's hardcoded pair — historical template had a `d`/`x` that don't
 * form a valid keypair, breaking `instance install -k`. Silent no-op when
 * the target file isn't there (non-remote templates).
 */
export async function writeWorkerKeysFile(targetDir: string, slug: string): Promise<boolean> {
  const keysPath = join(targetDir, 'worker', 'src', 'keys.ts')
  if (!(await pathExists(keysPath))) return false

  const kid = `${slug}-worker-key`
  const { privateJwk, publicJwk } = await generateEd25519Jwk(kid)
  await writeFile(keysPath, renderKeysFile(slug, kid, privateJwk, publicJwk), 'utf-8')

  const jwkDir = join(targetDir, 'worker', 'keys')
  await mkdir(jwkDir, { recursive: true })
  const jwkPath = join(jwkDir, `${slug}.localhost-worker.jwk.json`)
  await writeFile(jwkPath, JSON.stringify(privateJwk, null, 2) + '\n', { mode: 0o600 })

  return true
}

/**
 * Seed `worker/dist-client/index.html` with a one-line stub — but only when
 * the scaffolded `worker/wrangler.jsonc` declares an `assets` binding.
 *
 * That binding sets `assets.directory: ./dist-client`; without the directory
 * existing, `wrangler dev` refuses to boot with "assets.directory does not
 * exist" before the user has run `pnpm build` in `worker/client/`. Shipping a
 * stub lets the worker boot immediately on first `astrale domain dev up`; the
 * stub is overwritten the moment the SPA build runs.
 *
 * Templates without an `assets` binding (e.g. `minimal`, which ships no SPA)
 * get no placeholder. Gating on the binding — rather than the template name —
 * keeps this template-agnostic.
 */
export async function writeDistClientPlaceholder(targetDir: string): Promise<boolean> {
  const wranglerPath = join(targetDir, 'worker', 'wrangler.jsonc')
  if (!(await pathExists(wranglerPath))) return false
  // Match a real `"assets":` key (line-anchored), not a mention inside a `//`
  // comment — JSONC tolerates comments and trailing commas, so don't parse.
  const wrangler = await readFile(wranglerPath, 'utf-8')
  if (!/^\s*"assets"\s*:/m.test(wrangler)) return false

  const distDir = join(targetDir, 'worker', 'dist-client')
  await mkdir(distDir, { recursive: true })
  const indexPath = join(distDir, 'index.html')
  if (await pathExists(indexPath)) return false
  await writeFile(
    indexPath,
    '<!doctype html><html><body>Run `pnpm build` in worker/client to populate the SPA.</body></html>\n',
    'utf-8',
  )
  return true
}

function renderKeysFile(slug: string, kid: string, privateJwk: JWK, publicJwk: JWK): string {
  const fmtKey = (jwk: JWK, fields: readonly (keyof JWK)[]): string =>
    fields
      .filter((f) => jwk[f] !== undefined)
      .map((f) => `  ${String(f)}: '${String(jwk[f])}',`)
      .join('\n')

  const privateFields = ['kty', 'crv', 'alg', 'd', 'x'] as const
  const publicFields = ['kty', 'crv', 'alg', 'x'] as const

  return `/**
 * Ed25519 key pair for the ${slug} worker.
 *
 * Generated fresh at scaffold time by \`astrale domain init\` via
 * \`generateEd25519Jwk\` (cli/src/lib/keys.ts). Rotate before shipping to
 * real prod, and stop committing the file once rotation is automated.
 */
export const PRIVATE_JWK = {
${fmtKey(privateJwk, privateFields)}
  kid: '${kid}',
} as const

export const PUBLIC_JWK = {
${fmtKey(publicJwk, publicFields)}
  kid: '${kid}',
} as const
`
}

/** Convenience check — does `path` exist as a file or directory? */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
