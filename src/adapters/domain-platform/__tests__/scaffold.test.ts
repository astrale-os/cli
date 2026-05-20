import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readdir, readFile, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cloudflareDomainPlatform } from '../cloudflare'

const TEXT_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.md',
  '.yaml',
  '.yml',
  '.toml',
  '.env',
  '.example',
])

async function walkTextFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir)) {
    const p = join(dir, entry)
    const s = await stat(p)
    if (s.isDirectory()) {
      out.push(...(await walkTextFiles(p)))
      continue
    }
    const dot = entry.lastIndexOf('.')
    const ext = dot >= 0 ? entry.slice(dot) : ''
    if (TEXT_EXTS.has(ext)) out.push(p)
  }
  return out
}

/**
 * Both templates share the `astrale-domain` placeholder stem and the same
 * scaffold engine — the rename map / dispatch is template-agnostic, so the
 * behavioral guards (stem fully rewritten, no `workspace:*` deps, etc.) apply
 * to every template. The behavioral split between templates lives in the
 * cross-domain dep assertion: `default` MUST carry `@astrale-os/distribution-
 * domain` (semver, never `workspace:*`); `minimal` must NOT.
 */
const TEMPLATES = [
  { name: 'minimal', expectsDistDep: false },
  { name: 'default', expectsDistDep: true },
] as const

for (const { name: template, expectsDistDep } of TEMPLATES) {
  describe(`cloudflare scaffold — ${template} template`, () => {
    let tmp = ''

    beforeEach(async () => {
      tmp = await mkdtemp(join(tmpdir(), 'astrale-scaffold-test-'))
    })

    afterEach(async () => {
      await rm(tmp, { recursive: true, force: true })
    })

    test('scaffolds into targetDir and applies rename map', async () => {
      const targetDir = join(tmp, 'widget-shop')
      const result = await cloudflareDomainPlatform.scaffold({
        slug: 'widget-shop',
        template,
        targetDir,
      })

      expect(result.targetDir).toBe(targetDir)
      expect(result.slug).toBe('widget-shop')

      const pkg = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf-8')) as {
        name: string
      }
      expect(pkg.name).toBe('@astrale-os/widget-shop-domain')

      // Scaffolded domain must follow the standalone `domains/` idiom:
      // @astrale-os deps as external semver, never `workspace:*` (which
      // only resolves inside the linked monorepo). Swept across EVERY
      // package.json in the tree (root + worker + worker/client), deps
      // AND devDeps.
      const pkgFiles = (await walkTextFiles(targetDir)).filter((f) => f.endsWith('/package.json'))
      expect(
        pkgFiles.length,
        'expected root + worker + worker/client package.json',
      ).toBeGreaterThanOrEqual(3)

      let distDepCount = 0
      const SEMVER_RE = /^>=.*<1\.0\.0$/

      for (const pkgFile of pkgFiles) {
        const manifest = JSON.parse(await readFile(pkgFile, 'utf-8')) as {
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
        }
        const deps = { ...manifest.dependencies, ...manifest.devDependencies }
        for (const [dep, range] of Object.entries(deps)) {
          if (dep.startsWith('@astrale-os/')) {
            expect(
              range,
              `${dep} in ${pkgFile} must be a semver range, got "${range}"`,
            ).not.toContain('workspace:')
          }
          if (dep === '@astrale-os/distribution-domain') {
            distDepCount++
            expect(
              SEMVER_RE.test(range),
              `${dep} in ${pkgFile} must match semver range (got "${range}")`,
            ).toBe(true)
          }
        }
      }

      if (expectsDistDep) {
        expect(
          distDepCount,
          `${template} template must carry @astrale-os/distribution-domain`,
        ).toBeGreaterThan(0)
      } else {
        expect(
          distDepCount,
          `${template} template must NOT carry @astrale-os/distribution-domain`,
        ).toBe(0)
      }

      // tsconfig must extend the domains base one level up.
      const tsconfig = JSON.parse(await readFile(join(targetDir, 'tsconfig.json'), 'utf-8')) as {
        extends: string
        compilerOptions?: { paths?: unknown }
      }
      expect(tsconfig.extends).toBe('../tsconfig.base.json')
      expect(tsconfig.compilerOptions?.paths).toBeUndefined()

      const keys = await readFile(join(targetDir, 'worker', 'src', 'keys.ts'), 'utf-8')
      expect(keys).not.toContain('astrale-domain-worker-key')
      expect(keys).toContain('widget-shop-worker-key')

      // The load-bearing sweep: the placeholder stem must be fully gone
      // post-scaffold. spec.json is excluded from copy (DEFAULT_EXCLUDES)
      // but defensively skipped here too.
      for (const f of await walkTextFiles(targetDir)) {
        if (f.endsWith('/spec.json')) continue
        const content = await readFile(f, 'utf-8')
        expect(content, `"astrale-domain" still present in ${f}`).not.toContain('astrale-domain')
      }
    })

    test('refuses existing targetDir without --force', async () => {
      const targetDir = join(tmp, 'dup')
      await cloudflareDomainPlatform.scaffold({
        slug: 'first-one',
        template,
        targetDir,
      })
      await expect(
        cloudflareDomainPlatform.scaffold({
          slug: 'first-one',
          template,
          targetDir,
        }),
      ).rejects.toThrow(/TARGET_EXISTS|exists/)
    })
  })
}

describe('cloudflare scaffold — reserved slugs', () => {
  let tmp = ''

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'astrale-scaffold-test-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  for (const slug of ['astrale-domain', 'minimal', 'default'] as const) {
    test(`refuses reserved slug "${slug}"`, async () => {
      await expect(
        cloudflareDomainPlatform.scaffold({
          slug,
          template: 'default',
          targetDir: join(tmp, 'reserved'),
        }),
      ).rejects.toThrow(/RESERVED_SLUG|reserved/)
    })
  }
})
