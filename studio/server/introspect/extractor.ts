/** Bun subprocess that imports only the authored Schema entry and its installed SDK. */
import {
  admitCanonicalSchemaFromSdk,
  findCanonicalDomainSchemaExport,
  projectCanonicalSchema,
} from './canonical-schema'

const schemaPath = process.argv[2]
const projectRoot = process.argv[3] ?? process.cwd()

async function main(): Promise<void> {
  if (!schemaPath) throw new Error('extractor: missing <schemaPath>')
  const exports = (await import(schemaPath)) as Record<string, unknown>
  const candidate = findCanonicalDomainSchemaExport(exports)
  if (candidate === null) {
    throw new Error('Schema entry exports no canonical V1 DomainSchema.')
  }
  const sdk = (await import(Bun.resolveSync('@astrale-os/sdk/schema', projectRoot))) as Record<
    string,
    unknown
  >
  const admission = admitCanonicalSchemaFromSdk(sdk, candidate)
  const projected = projectCanonicalSchema(admission.root, admission.closure)
  process.stdout.write(
    JSON.stringify({
      ok: true,
      ir: projected.ir,
      root: admission.root,
      schemaMode: admission.status === 'admitted' ? 'canonical-admitted' : 'canonical-preview',
      revision: admission.revision,
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
