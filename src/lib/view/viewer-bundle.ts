import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

import { InternalError } from '../../errors'
import { isViewerFile } from './viewer-files'

/** Build the `astrale view` host page from `viewer/` with Bun and the Tailwind CLI. */
export async function buildViewerBundle(options: {
  /** The `viewer/` source directory. */
  source: string
  outdir: string
  minify: boolean
}): Promise<readonly string[]> {
  const { source, outdir, minify } = options
  await rm(outdir, { recursive: true, force: true })
  const result = await Bun.build({
    entrypoints: [join(source, 'main.ts')],
    outdir,
    target: 'browser',
    format: 'esm',
    // The node selector is its own chunk: a page whose View never asks for Nodes never fetches it.
    splitting: true,
    minify,
    naming: { entry: '[name].[ext]', chunk: 'chunk-[hash].[ext]' },
    define: { 'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development') },
  })
  if (!result.success) {
    throw new InternalError(`viewer build failed:\n${result.logs.map(String).join('\n')}`)
  }
  const stylesheet = join(source, 'finder', 'finder.css')
  if (existsSync(stylesheet)) await buildStylesheet(source, stylesheet, outdir, minify)
  await copyFile(join(source, 'index.html'), join(outdir, 'index.html'))

  const files = await listFiles(outdir)
  const unexpected = files.filter((file) => !isViewerFile(file))
  if (unexpected.length > 0) {
    throw new InternalError(
      `viewer build emitted an unsupported asset set: ${unexpected.join(', ')}`,
    )
  }
  return files
}

/** Compile the node selector's stylesheet with Tailwind, and serve its fonts beside it. */
async function buildStylesheet(
  source: string,
  input: string,
  outdir: string,
  minify: boolean,
): Promise<void> {
  const tailwind = findUp(source, join('node_modules', '.bin', 'tailwindcss'))
  if (tailwind === undefined) {
    throw new InternalError('The viewer stylesheet needs the Tailwind CLI; run `pnpm install`.')
  }
  const output = join(outdir, 'finder.css')
  const compiled = Bun.spawnSync(
    [tailwind, '-i', input, '-o', output, ...(minify ? ['--minify'] : [])],
    {
      cwd: source,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  )
  if (compiled.exitCode !== 0) {
    throw new InternalError(`viewer stylesheet build failed:\n${compiled.stderr.toString()}`)
  }

  // The runtime package's presets name their fonts relative to their own directory.
  const fonts = join(
    dirname(Bun.resolveSync('@astrale-os/ui/presets/astrale.css', source)),
    '..',
    'fonts',
  )
  const named = new Set<string>()
  const css = (await readFile(output, 'utf8')).replace(
    /url\((['"]?)\.\.\/fonts\/([a-z0-9-]+\.woff2)\1\)/gu,
    (_match, quote: string, file: string) => {
      named.add(file)
      return `url(${quote}./fonts/${file}${quote})`
    },
  )
  const unresolved = [...css.matchAll(/url\((['"]?)(?!data:|\.\/fonts\/)([^'")]*)\1\)/gu)]
  if (unresolved.length > 0) {
    throw new InternalError(
      `viewer stylesheet names files it does not ship: ${unresolved.map((match) => match[2]).join(', ')}`,
    )
  }
  await writeFile(output, css)
  if (named.size === 0) return
  await mkdir(join(outdir, 'fonts'))
  for (const file of named) await copyFile(join(fonts, file), join(outdir, 'fonts', file))
  // The fonts' license travels with them.
  for (const license of (await readdir(fonts)).filter((file) => file.endsWith('.txt'))) {
    await copyFile(join(fonts, license), join(outdir, 'fonts', license))
  }
}

function findUp(start: string, path: string): string | undefined {
  for (let directory = start; ; directory = dirname(directory)) {
    const candidate = join(directory, path)
    if (existsSync(candidate)) return candidate
    if (dirname(directory) === directory) return undefined
  }
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}
