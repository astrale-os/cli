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
