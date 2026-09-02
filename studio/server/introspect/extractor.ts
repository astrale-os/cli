/** Bun subprocess that imports only the authored Schema entry and its installed SDK. */
import type { SchemaSdk } from './canonical-schema'

import { extractCanonicalSchemaFromSdk, findCanonicalDomainSchemaExport } from './canonical-schema'
import { evaluateIsland, installedSdkExport, reportFailure } from './island'

const schemaPath = process.argv[2]
const projectRoot = process.argv[3] ?? process.cwd()

async function main(): Promise<void> {
  if (!schemaPath) throw new Error('extractor: missing <schemaPath>')
  const island = await evaluateIsland({
    projectRoot,
    authoredPath: schemaPath,
    sdkPath: await installedSdkExport(projectRoot, './schema'),
    label: 'schema',
  })
  const candidate = findCanonicalDomainSchemaExport(island.authored)
  if (candidate === null) throw new Error('Schema entry exports no canonical V1 DomainSchema.')
  const extraction = extractCanonicalSchemaFromSdk(island.sdk as unknown as SchemaSdk, candidate)
  process.stdout.write(
    JSON.stringify({
      ok: true,
      ir: extraction.ir,
      root: extraction.root,
      schemaMode: extraction.status === 'admitted' ? 'canonical-admitted' : 'canonical-preview',
      revision: extraction.revision,
    }),
  )
}

main().catch(reportFailure)
