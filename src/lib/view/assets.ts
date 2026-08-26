import { existsSync, statSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The prebuilt host-page bundle, shipped next to the CLI module
 * (`<pkg>/viewer/dist`). The module URL is authoritative because npm global
 * installs expose the CLI through a bin symlink outside the package root.
 */
export function viewerDistDir(
  moduleUrl = import.meta.url,
  entry = process.argv[1] ?? '.',
  executable = process.execPath,
): string {
  const override = process.env.ASTRALE_VIEWER_DIR
  if (override) return override

  const moduleDirectory = dirname(fileURLToPath(moduleUrl))
  const published = join(moduleDirectory, '..', 'viewer', 'dist')
  const source = join(moduleDirectory, '..', '..', '..', 'viewer', 'dist')
  const legacy = join(dirname(entry), '..', 'viewer', 'dist')
  const standalone = entry.startsWith('/$bunfs/')
    ? join(dirname(executable), 'viewer', 'dist')
    : undefined
  const complete = [standalone, published, source, legacy].find(
    (candidate): candidate is string => candidate !== undefined && hasViewerBundle(candidate),
  )
  if (complete) return complete

  // A source checkout may intentionally omit generated dist assets. Keep the
  // source-derived destination so ensureViewerAssets can build it on demand.
  if (hasViewerSource(join(source, '..'))) return source

  // Published installs cannot rebuild: preserve the package-relative path in
  // the diagnostic instead of pointing at the npm prefix beside the bin link.
  return published
}

/** Ensure the host bundle exists; on a dev checkout, build it with Bun. */
export async function ensureViewerAssets(
  moduleUrl = import.meta.url,
  entry = process.argv[1] ?? '.',
): Promise<string> {
  const dist = viewerDistDir(moduleUrl, entry)
  const srcDir = join(dist, '..')
  if (hasViewerBundle(dist) && !viewerSourceIsNewer(srcDir, dist)) return dist
  const bun = (
    globalThis as { Bun?: { build: (o: object) => Promise<{ success: boolean; logs: unknown[] }> } }
  ).Bun
  if (bun && hasViewerSource(srcDir)) {
    const result = await bun.build({
      entrypoints: [join(srcDir, 'main.ts')],
      outdir: dist,
      target: 'browser',
      minify: false,
    })
    if (!result.success) throw new Error(`viewer build failed: ${result.logs.join('\n')}`)
    await copyFile(join(srcDir, 'index.html'), join(dist, 'index.html'))
    return dist
  }
  throw new Error(
    `viewer bundle missing at ${dist} — reinstall the CLI (or run \`bun scripts/build.ts\` in a dev checkout)`,
  )
}

function hasViewerBundle(directory: string): boolean {
  return existsSync(join(directory, 'main.js')) && existsSync(join(directory, 'index.html'))
}

function hasViewerSource(directory: string): boolean {
  return existsSync(join(directory, 'main.ts')) && existsSync(join(directory, 'index.html'))
}

function viewerSourceIsNewer(source: string, dist: string): boolean {
  if (!hasViewerSource(source)) return false
  if (!hasViewerBundle(dist)) return true
  const newestSource = Math.max(
    statSync(join(source, 'main.ts')).mtimeMs,
    statSync(join(source, 'index.html')).mtimeMs,
  )
  const oldestOutput = Math.min(
    statSync(join(dist, 'main.js')).mtimeMs,
    statSync(join(dist, 'index.html')).mtimeMs,
  )
  return newestSource > oldestOutput
}
