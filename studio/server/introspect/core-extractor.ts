/** Bun subprocess that projects canonical Core directly from the pure Schema entry. */
import { isAbsolute, resolve } from 'node:path'

import { findCanonicalDomainSchemaExport, projectCanonicalCore } from './canonical-schema'

const projectRoot = process.argv[3] ?? process.cwd()
const input = process.argv[2]
const schemaFile = input && !isAbsolute(input) ? resolve(projectRoot, input) : input

async function main(): Promise<void> {
  if (!schemaFile) throw new Error('core-extractor: missing <schemaPath>')
  const exports = (await import(schemaFile)) as Record<string, unknown>
  const schema = findCanonicalDomainSchemaExport(exports)
  if (schema === null) throw new Error('Schema entry exports no canonical V1 DomainSchema.')
  const core = projectCanonicalCore(schema)
  process.stdout.write(
    JSON.stringify({
      ok: true,
      core: core.nodes.length === 0 && core.edges.length === 0 ? null : core,
    }),
  )
}

main().catch((cause: unknown) => {
  const error = cause instanceof Error ? cause : new Error(String(cause))
  process.stdout.write(
    JSON.stringify({ ok: false, error: { message: error.message, stack: error.stack ?? '' } }),
  )
  process.exit(0)
})
