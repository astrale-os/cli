/**
 * island.ts — build and evaluate one short-lived Bun island rooted at a Domain.
 *
 * A compiled Bun executable cannot resolve package imports from a dynamic, external
 * TypeScript entrypoint. Both extractors therefore bundle the authored module together
 * with that Domain's exact installed SDK facade, then evaluate the CJS result in-process.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Resolve one `@astrale-os/sdk` export subpath from the Domain's own installed SDK. */
export async function installedSdkExport(root: string, subpath: string): Promise<string> {
  let directory = root
  for (;;) {
    const packageRoot = join(directory, 'node_modules', '@astrale-os', 'sdk')
    const manifestPath = join(packageRoot, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        exports?: Record<string, string | { import?: string; default?: string; types?: string }>
      }
      const exported = manifest.exports?.[subpath]
      const target =
        typeof exported === 'string'
          ? exported
          : (exported?.import ?? exported?.default ?? exported?.types)
      if (target) return join(packageRoot, target)
      throw new Error(`${manifestPath} does not export @astrale-os/sdk/${subpath.slice(2)}`)
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`Cannot find @astrale-os/sdk from ${root}`)
}

export function buildFailure(cause: unknown): Error {
  if (cause && typeof cause === 'object') {
    const errors = (cause as { errors?: unknown[] }).errors
    if (Array.isArray(errors) && errors.length > 0) {
      const details = errors
        .map((entry) => (entry instanceof Error ? entry.message : String(entry)))
        .join('\n')
      return new Error(details, { cause })
    }
  }
  return cause instanceof Error ? cause : new Error(String(cause))
}

/**
 * Bundle `{ authored, sdk }` from the Domain and evaluate the result. The process must
 * start OUTSIDE the Domain so a compiled Bun runtime can build authored package imports;
 * the author's expected cwd is restored only after that build, before evaluation.
 */
export async function evaluateIsland(input: {
  readonly projectRoot: string
  readonly authoredPath: string
  readonly sdkPath: string
  readonly label: string
}): Promise<{ authored: Record<string, unknown>; sdk: Record<string, unknown> }> {
  const temporary = await mkdtemp(join(tmpdir(), 'astrale-studio-extractor-'))
  try {
    const wrapper = join(temporary, 'entry.ts')
    await writeFile(
      wrapper,
      `import * as authored from ${JSON.stringify(input.authoredPath)};\n` +
        `import * as sdk from ${JSON.stringify(input.sdkPath)};\n` +
        `export { authored, sdk };\n`,
    )
    const built = await Bun.build({
      entrypoints: [wrapper],
      outdir: temporary,
      target: 'bun',
      format: 'cjs',
      packages: 'bundle',
    }).catch((cause: unknown) => {
      throw buildFailure(cause)
    })
    if (!built.success) {
      const details = built.logs
        .map((log) => {
          const position = log.position
          const location = position ? `${position.file}:${position.line}:${position.column}: ` : ''
          return `${location}${log.message}`
        })
        .join('\n')
      throw new Error(details || `${input.label} bundle failed`)
    }
    const output = built.outputs.find((candidate) => candidate.kind === 'entry-point')
    if (!output) throw new Error(`${input.label} bundle produced no entrypoint`)
    const source = await output.text()

    process.chdir(input.projectRoot)
    const module = { exports: {} as Record<string, unknown> }
    const require = createRequire(pathToFileURL(join(input.projectRoot, 'package.json')))
    const factory = new Function(`return (\n${source}\n);`)() as (
      exports: Record<string, unknown>,
      require: NodeRequire,
      module: { exports: Record<string, unknown> },
      filename: string,
      directory: string,
    ) => void
    factory(module.exports, require, module, output.path, dirname(output.path))
    const island = module.exports as {
      authored?: Record<string, unknown>
      sdk?: Record<string, unknown>
    }
    if (!island?.authored || !island?.sdk) {
      throw new Error(
        `${input.label} bundle exports are invalid (${Object.keys(island ?? {}).join(', ')})`,
      )
    }
    return { authored: island.authored, sdk: island.sdk }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

/** Every extractor answers on stdout, errors included, and never crashes the caller. */
export function reportFailure(cause: unknown): never {
  const error = cause instanceof Error ? cause : new Error(String(cause))
  process.stdout.write(
    JSON.stringify({ ok: false, error: { message: error.message, stack: error.stack ?? '' } }),
  )
  process.exit(0)
}
