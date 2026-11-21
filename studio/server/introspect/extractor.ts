/**
 * Bun subprocess that imports only the authored Schema entry and its installed SDK.
 *
 * `extractor <schemaPath> <projectRoot>` reads one Domain's authored Schema.
 * `extractor --kernel <projectRoot>` reads the Kernel Schema the project's installed SDK
 * ships (`KernelSchema` of `@astrale-os/sdk/schema`), so Studio shows the exact Kernel
 * that project is built against.
 */
import type { CanonicalDomainSchemaV1, SchemaSdk } from './canonical-schema'

import {
  extractCanonicalSchemaFromSdk,
  findCanonicalDomainSchemaExport,
  isCanonicalDomainSchemaV1,
} from './canonical-schema'
import { evaluateIsland, installedSdkExport, reportFailure } from './island'

const kernelMode = process.argv[2] === '--kernel'
const schemaPath = kernelMode ? undefined : process.argv[2]
const projectRoot = process.argv[3] ?? process.cwd()

async function main(): Promise<void> {
  if (!kernelMode && !schemaPath) throw new Error('extractor: missing <schemaPath>')
  const sdkPath = await installedSdkExport(projectRoot, './schema')
  const island = await evaluateIsland({
    projectRoot,
    // The Kernel has no authored module: the SDK itself is the only thing to read.
    authoredPath: schemaPath ?? sdkPath,
    sdkPath,
    label: kernelMode ? 'kernel' : 'schema',
  })
  const candidate = kernelMode
    ? kernelSchemaOf(island.sdk)
    : findCanonicalDomainSchemaExport(island.authored)
  if (candidate === null) {
    throw new Error(
      kernelMode
        ? 'The installed SDK exports no canonical Kernel Schema.'
        : 'Schema entry exports no canonical V1 DomainSchema.',
    )
  }
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

function kernelSchemaOf(sdk: Record<string, unknown>): CanonicalDomainSchemaV1 | null {
  return isCanonicalDomainSchemaV1(sdk.KernelSchema) ? sdk.KernelSchema : null
}

main().catch(reportFailure)
