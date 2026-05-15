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

describe('cloudflare scaffold — minimal-remote template', () => {
  let tmp = ''

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'astrale-scaffold-test-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('scaffolds minimal-remote into targetDir and applies rename map', async () => {
    const targetDir = join(tmp, 'widget-shop')
    const result = await cloudflareDomainPlatform.scaffold({
      slug: 'widget-shop',
      template: 'minimal-remote',
      targetDir,
    })

    expect(result.targetDir).toBe(targetDir)
    expect(result.slug).toBe('widget-shop')

    const pkg = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf-8')) as {
      name: string
    }
    expect(pkg.name).toBe('@astrale-os/widget-shop-domain')

    // Scaffolded domain must follow the standalone `domains/` idiom
    // (see domains/notes): @astrale-os deps as external semver, never
    // workspace:* (which only resolves inside the linked monorepo).
    // Swept across EVERY package.json in the tree (root + worker +
    // worker/client), deps AND devDeps — a single-file check is why a
    // `shell: workspace:*` in worker/client once slipped through.
    const pkgFiles = (await walkTextFiles(targetDir)).filter((f) => f.endsWith('/package.json'))
    // Guard against a silent no-op if the template is ever restructured:
    // the minimal-remote template ships exactly these three packages.
    expect(
      pkgFiles.length,
      'expected root + worker + worker/client package.json',
    ).toBeGreaterThanOrEqual(3)
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
      }
    }

    // tsconfig must extend the domains base one level up (→ domains/
    // tsconfig.base.json = @astrale/typescript-config/library), not the
    // root base, and must NOT carry a vestigial kernel-source `paths` block.
    const tsconfig = JSON.parse(await readFile(join(targetDir, 'tsconfig.json'), 'utf-8')) as {
      extends: string
      compilerOptions?: { paths?: unknown }
    }
    expect(tsconfig.extends).toBe('../tsconfig.base.json')
    expect(tsconfig.compilerOptions?.paths).toBeUndefined()

    const keys = await readFile(join(targetDir, 'worker', 'src', 'keys.ts'), 'utf-8')
    expect(keys).not.toContain('minimal-remote-worker-key')
    expect(keys).toContain('widget-shop-worker-key')

    for (const f of await walkTextFiles(targetDir)) {
      if (f.endsWith('/spec.json')) continue
      const content = await readFile(f, 'utf-8')
      expect(content, `"minimal-remote" still present in ${f}`).not.toContain('minimal-remote')
    }
  })

  test('refuses reserved slugs', async () => {
    await expect(
      cloudflareDomainPlatform.scaffold({
        slug: 'minimal-remote',
        template: 'minimal-remote',
        targetDir: join(tmp, 'reserved'),
      }),
    ).rejects.toThrow(/RESERVED_SLUG|reserved/)
  })

  test('refuses existing targetDir without --force', async () => {
    const targetDir = join(tmp, 'dup')
    await cloudflareDomainPlatform.scaffold({
      slug: 'first-one',
      template: 'minimal-remote',
      targetDir,
    })
    await expect(
      cloudflareDomainPlatform.scaffold({
        slug: 'first-one',
        template: 'minimal-remote',
        targetDir,
      }),
    ).rejects.toThrow(/TARGET_EXISTS|exists/)
  })
})
