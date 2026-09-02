/**
 * Bun subprocess that imports ONE referenced Dataset module and the Domain's installed
 * `@astrale-os/sdk/testing` facade, then prints the portable encoded Dataset. It never
 * imports `astrale.config.ts` or `application.ts`: a Dataset module reaches the Schema
 * only, so a broken adapter or Runtime cannot take the demo data down with it.
 */
import { evaluateIsland, installedSdkExport, reportFailure } from './island'

const modulePath = process.argv[2]
const projectRoot = process.argv[3] ?? process.cwd()

interface TestingSdk {
  isDataset(value: unknown): boolean
  encodeDataset(value: unknown): unknown
}

async function main(): Promise<void> {
  if (!modulePath) throw new Error('dataset extractor: missing <modulePath>')
  let sdkPath: string
  try {
    sdkPath = await installedSdkExport(projectRoot, './testing')
  } catch (cause) {
    throw new Error(
      `${cause instanceof Error ? cause.message : String(cause)} — Datasets need an @astrale-os/sdk that exports ./testing; upgrade the domain's SDK.`,
    )
  }
  const island = await evaluateIsland({
    projectRoot,
    authoredPath: modulePath,
    sdkPath,
    label: 'dataset',
  })
  const sdk = island.sdk as unknown as TestingSdk
  if (typeof sdk.isDataset !== 'function' || typeof sdk.encodeDataset !== 'function') {
    throw new Error('installed @astrale-os/sdk/testing lacks the Dataset codec')
  }
  const keys = Object.keys(island.authored)
  if (!keys.includes('default') || keys.some((key) => key !== 'default')) {
    throw new Error(
      `Dataset module must export exactly one default Dataset (found: ${keys.join(', ') || 'nothing'})`,
    )
  }
  const candidate = island.authored.default
  if (!sdk.isDataset(candidate)) {
    throw new Error(
      'Dataset module default export is not an admitted Dataset — define it with defineDataset from @astrale-os/sdk/testing',
    )
  }
  process.stdout.write(JSON.stringify({ ok: true, dataset: sdk.encodeDataset(candidate) }))
}

main().catch(reportFailure)
