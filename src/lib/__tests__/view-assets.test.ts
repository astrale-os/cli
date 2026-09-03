import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

import { embeddedAssetDir } from '../embedded-assets'
import { ensureViewerAssets, viewerDistDir } from '../view/assets'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('viewer asset resolution', () => {
  test('provides the host language and sufficient contrast for secondary labels', async () => {
    const source = await readFile(
      join(import.meta.dirname, '..', '..', '..', 'viewer', 'index.html'),
      'utf8',
    )

    expect(source).toContain('<html lang="en">')
    expect(
      contrast(sourceColor(source, 'body', 'background'), sourceColor(source, '.dim')),
    ).toBeGreaterThanOrEqual(4.5)
  })

  test('keeps long placement labels from widening the mounted View viewport', async () => {
    const source = await readFile(
      join(import.meta.dirname, '..', '..', '..', 'viewer', 'index.html'),
      'utf8',
    )

    expect(source).toContain('#view-label,')
    expect(source).toContain('text-overflow: ellipsis;')
    expect(source).toContain('#frame {\n        flex: 1;\n        min-width: 0;')
  })

  test('skips partial candidates and prefers complete package-owned assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-view-candidates-'))
    temporaryDirectories.push(root)
    const prefix = join(root, '.npm-global')
    const packageRoot = join(prefix, 'lib', 'node_modules', '@astrale-os', 'cli')
    const entry = join(prefix, 'bin', 'astrale')
    const bundle = join(packageRoot, 'dist', 'astrale.js')
    const published = join(packageRoot, 'viewer', 'dist')
    const legacy = join(prefix, 'viewer', 'dist')

    await mkdir(dirname(bundle), { recursive: true })
    await mkdir(published, { recursive: true })
    await mkdir(legacy, { recursive: true })
    await writeFile(bundle, '')
    await writeFile(join(published, 'main.js'), '')
    await writeFile(join(legacy, 'main.js'), '')
    await writeFile(join(legacy, 'index.html'), '')

    expect(viewerDistDir(pathToFileURL(bundle).href, entry)).toBe(legacy)

    await writeFile(join(published, 'index.html'), '')
    expect(viewerDistDir(pathToFileURL(bundle).href, entry)).toBe(published)
  })

  test('builds missing viewer assets in a clean source checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-view-source-'))
    temporaryDirectories.push(root)
    const module = join(root, 'src', 'lib', 'view', 'assets.ts')
    const source = join(root, 'viewer')
    const dist = join(source, 'dist')

    await mkdir(dirname(module), { recursive: true })
    await mkdir(source, { recursive: true })
    await writeFile(module, '')
    await writeFile(join(source, 'main.ts'), 'document.body.textContent = "viewer ready"\n')
    await writeFile(join(source, 'index.html'), '<!doctype html><body></body>\n')

    expect(await ensureViewerAssets(pathToFileURL(module).href, join(root, 'bin', 'astrale'))).toBe(
      dist,
    )
    expect(await readFile(join(dist, 'index.html'), 'utf8')).toContain('<body>')
    expect(await readFile(join(dist, 'main.js'), 'utf8')).toContain('viewer ready')
  })

  test('rebuilds stale viewer assets in a source checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-view-stale-'))
    temporaryDirectories.push(root)
    const module = join(root, 'src', 'lib', 'view', 'assets.ts')
    const source = join(root, 'viewer')
    const dist = join(source, 'dist')

    await mkdir(dirname(module), { recursive: true })
    await mkdir(dist, { recursive: true })
    await writeFile(module, '')
    await writeFile(join(source, 'main.ts'), 'document.body.textContent = "fresh viewer"\n')
    await writeFile(join(source, 'index.html'), '<!doctype html><body>fresh</body>\n')
    await writeFile(join(dist, 'main.js'), 'document.body.textContent = "stale viewer"\n')
    await writeFile(join(dist, 'index.html'), '<!doctype html><body>stale</body>\n')
    const future = new Date(Date.now() + 2_000)
    await utimes(join(source, 'main.ts'), future, future)

    await ensureViewerAssets(pathToFileURL(module).href, join(root, 'bin', 'astrale'))

    expect(await readFile(join(dist, 'main.js'), 'utf8')).toContain('fresh viewer')
    expect(await readFile(join(dist, 'index.html'), 'utf8')).toContain('fresh')
  })

  test('uses the bundled module location when invoked through a global bin symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-view-bundle-'))
    temporaryDirectories.push(root)
    const prefix = join(root, '.npm-global')
    const packageRoot = join(prefix, 'lib', 'node_modules', '@astrale-os', 'cli')
    const entry = join(prefix, 'bin', 'astrale')
    const sourceEntry = join(root, 'entry.ts')
    const viewer = join(packageRoot, 'viewer', 'dist')
    const assetsPath = join(import.meta.dirname, '..', 'view', 'assets.ts')
    const relativeAssetsPath = relative(
      await realpath(dirname(sourceEntry)),
      await realpath(assetsPath),
    )
    const assetsModule = relativeAssetsPath.startsWith('.')
      ? relativeAssetsPath
      : `./${relativeAssetsPath}`

    await mkdir(join(prefix, 'bin'), { recursive: true })
    await mkdir(viewer, { recursive: true })
    await writeFile(join(viewer, 'main.js'), '')
    await writeFile(join(viewer, 'index.html'), '')
    await writeFile(
      sourceEntry,
      `import { viewerDistDir } from ${JSON.stringify(assetsModule)}\nconsole.log(viewerDistDir())\n`,
    )
    const build = await Bun.build({
      entrypoints: [sourceEntry],
      outdir: join(packageRoot, 'dist'),
      target: 'node',
      format: 'esm',
    })
    expect(build.success).toBe(true)
    await symlink(
      join('..', 'lib', 'node_modules', '@astrale-os', 'cli', 'dist', 'entry.js'),
      entry,
    )

    const node = Bun.which('node')
    expect(node).not.toBeNull()
    const process = Bun.spawn([node!, entry], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(stdout.trim()).toBe(await realpath(viewer))
  })

  test('resolves assets materialized from a Bun-compiled standalone executable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-view-standalone-'))
    temporaryDirectories.push(root)
    const viewer = embeddedAssetDir('viewer', root)
    await mkdir(viewer, { recursive: true })
    await writeFile(join(viewer, 'main.js'), '')
    await writeFile(join(viewer, 'index.html'), '')

    const previous = process.env.ASTRALE_HOME
    process.env.ASTRALE_HOME = root
    try {
      expect(viewerDistDir('file:///$bunfs/root/assets.ts', '/$bunfs/root/astrale')).toBe(viewer)
    } finally {
      if (previous === undefined) delete process.env.ASTRALE_HOME
      else process.env.ASTRALE_HOME = previous
    }
  })
})

function sourceColor(source: string, selector: string, property = 'color'): string {
  const blocks = source.matchAll(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, 'g'))
  for (const block of blocks) {
    const color = block[1].match(new RegExp(`${property}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
    if (color) return color
  }
  throw new Error(`Missing ${property} for ${selector}`)
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
