/** Bun subprocess that imports only the authored Schema entry and its installed SDK. */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { SchemaSdk } from './canonical-schema'

import { extractCanonicalSchemaFromSdk, findCanonicalDomainSchemaExport } from './canonical-schema'

const schemaPath = process.argv[2]
const projectRoot = process.argv[3] ?? process.cwd()

async function installedSdkSchema(root: string): Promise<string> {
  let directory = root
  for (;;) {
    const packageRoot = join(directory, 'node_modules', '@astrale-os', 'sdk')
    const manifestPath = join(packageRoot, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        exports?: Record<string, string | { import?: string; default?: string; types?: string }>
      }
      const exported = manifest.exports?.['./schema']
      const target =
        typeof exported === 'string'
          ? exported
          : (exported?.import ?? exported?.default ?? exported?.types)
      if (target) return join(packageRoot, target)
      throw new Error(`${manifestPath} does not export @astrale-os/sdk/schema`)
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`Cannot find @astrale-os/sdk from ${root}`)
}

function buildFailure(cause: unknown): Error {
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

async function main(): Promise<void> {
  if (!schemaPath) throw new Error('extractor: missing <schemaPath>')
  const temporary = await mkdtemp(join(tmpdir(), 'astrale-studio-extractor-'))
  try {
    // A compiled Bun executable cannot resolve package imports from a dynamic,
    // external TypeScript entrypoint. Build one short-lived island rooted at the
    // Domain instead: Bun resolves and bundles the authored Schema plus that
    // Domain's exact SDK, then the standalone extractor imports the result.
    const sdkPath = await installedSdkSchema(projectRoot)
    const wrapper = join(temporary, 'entry.ts')
    await writeFile(
      wrapper,
      `import * as authored from ${JSON.stringify(schemaPath)};\n` +
        `import * as sdk from ${JSON.stringify(sdkPath)};\n` +
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
      throw new Error(details || 'schema bundle failed')
    }
    const output = built.outputs.find((candidate) => candidate.kind === 'entry-point')
    if (!output) throw new Error('schema bundle produced no entrypoint')
    const source = await output.text()

    // The extractor must start outside the Domain so a compiled Bun runtime can
    // build authored package imports. Restore the author's expected cwd only
    // after that build, before evaluating the inert Schema bundle.
    process.chdir(projectRoot)
    const module = { exports: {} as Record<string, unknown> }
    const require = createRequire(pathToFileURL(join(projectRoot, 'package.json')))
    const factory = new Function(`return (\n${source}\n);`)() as (
      exports: Record<string, unknown>,
      require: NodeRequire,
      module: { exports: Record<string, unknown> },
      filename: string,
      directory: string,
    ) => void
    factory(module.exports, require, module, output.path, dirname(output.path))
    const island = module.exports as {
      authored: Record<string, unknown>
      sdk: SchemaSdk
    }
    if (!island?.authored || !island?.sdk) {
      throw new Error(`schema bundle exports are invalid (${Object.keys(island ?? {}).join(', ')})`)
    }
    const candidate = findCanonicalDomainSchemaExport(island.authored)
    if (candidate === null) throw new Error('Schema entry exports no canonical V1 DomainSchema.')
    const extraction = extractCanonicalSchemaFromSdk(island.sdk, candidate)
    process.stdout.write(
      JSON.stringify({
        ok: true,
        ir: extraction.ir,
        root: extraction.root,
        schemaMode: extraction.status === 'admitted' ? 'canonical-admitted' : 'canonical-preview',
        revision: extraction.revision,
      }),
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

main().catch((cause: unknown) => {
  const error = cause instanceof Error ? cause : new Error(String(cause))
  process.stdout.write(
    JSON.stringify({ ok: false, error: { message: error.message, stack: error.stack ?? '' } }),
  )
  process.exit(0)
})
