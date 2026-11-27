/**
 * The `astrale` the E2E server runs (see `server.ts`). It is the real CLI, except for the two
 * registry reads the versions service issues about an origin `registry.ts` serves: the index
 * (`domain versions <origin>`) and a Publication's bundle (`__domain-registry bundle
 * <origin>@<version> --output <file>`). A served bundle holds the fixture's Payments Classes at
 * one stage, under the origin served, encoded by the fixture's own SDK, so the Studio decodes,
 * checks and projects it exactly as it does a bundle the registry serves. Every other command
 * runs the real CLI in this process.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PAYMENTS, registryFile, type RegistryAnswer, type SchemaStage } from './registry'

const FIXTURE = join(import.meta.dir, 'fixture')
const CLI = join(import.meta.dir, '..', '..', 'bin', 'astrale.ts')

/** A document to print on stdout, and the exit code the CLI would end with. */
interface Answer {
  document: unknown
  exitCode: number
}

const sha256 = (bytes: Uint8Array | string) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

async function servedAnswer(origin: string): Promise<RegistryAnswer | undefined> {
  const text = await readFile(registryFile(origin), 'utf8').catch(() => undefined)
  return text === undefined ? undefined : (JSON.parse(text) as RegistryAnswer)
}

/** The CT29 document a registry command prints for a refusal or an unreadable answer. */
function refused(answer: Exclude<RegistryAnswer, { answer: 'index' }>): Answer {
  if (answer.answer === 'unreadable')
    return { document: { neither: 'index nor error' }, exitCode: 0 }
  const { code, message, details } = answer
  return { document: { error: { code, message, ...(details ? { details } : {}) } }, exitCode: 1 }
}

// ─── The Payments Classes at each stage ────────────────────────────────────────

interface Encoded {
  bytes: Uint8Array
  revision: string
  dependencies: Array<{ origin: string; revision: string }>
}

/**
 * The Schema `origin` publishes at `stage`. Payments as built is the fixture's own Schema, so its
 * revision is the one Crm is built against; every other is assembled here from Classes of its
 * own, since a Class value belongs to the one Schema that first declares it.
 */
async function encoded(origin: string, stage: SchemaStage): Promise<Encoded> {
  // the fixture's SDK, the one instance its authored Schema is built with
  const sdk = await import(Bun.resolveSync('@astrale-os/sdk/schema', FIXTURE))
  const { PaymentsSchema } = await import(join(FIXTURE, 'schema', 'external.ts'))
  const { string } = await import(join(FIXTURE, 'schema', 'values.ts'))
  const { icons } = await import(join(FIXTURE, 'schema', 'icons.ts'))
  const declared = (description: string, property: string) =>
    sdk.nodeClass({
      policies: { read: true },
      description,
      icon: icons.payment,
      properties: { [property]: string },
    })
  const classes = () => {
    const PaymentProcessor = declared(
      'An external provider that processes customer payments.',
      'name',
    )
    if (stage === 'before-payouts') return { PaymentProcessor }
    const Payout = declared('A transfer of settled funds to the merchant.', 'reference')
    if (stage === 'as-built') return { PaymentProcessor, Payout }
    const Refund = declared('Money returned to a customer for a settled payment.', 'reference')
    return { PaymentProcessor, Payout, Refund }
  }
  const authored =
    origin === PAYMENTS && stage === 'as-built'
      ? PaymentsSchema
      : sdk.defineSchema(origin, { name: 'Test Domain', classes: classes() })
  const bundle = sdk.bundle.accept(sdk.bundle.create(authored))
  return {
    bytes: sdk.bundle.encode(bundle),
    revision: sdk.schema.revision(bundle.root),
    dependencies: bundle.closure.map((root: { origin: string }) => ({
      origin: root.origin,
      revision: sdk.schema.revision(root),
    })),
  }
}

// ─── The two registry reads ────────────────────────────────────────────────────

async function versions(origin: string): Promise<Answer | undefined> {
  const served = await servedAnswer(origin)
  if (!served) return undefined
  if (served.answer !== 'index') return refused(served)
  const publications = []
  for (const publication of served.publications) {
    const schema = await encoded(origin, publication.stage)
    publications.push({
      version: publication.version,
      url: `https://registry.e2e.invalid/${origin}/${publication.version}`,
      releaseDigest: sha256(`release ${origin}@${publication.version} ${schema.revision}`),
      buildDigest: sha256(`build ${origin}@${publication.version}`),
      schemaRevision: schema.revision,
      dependencies: schema.dependencies,
      dirty: false,
      yanked: publication.yanked === true,
      publishedAt: publication.publishedAt,
    })
  }
  return {
    document: { format: 'astrale.registry-index', version: 1, origin, publications },
    exitCode: 0,
  }
}

async function bundle(address: string, output: string | undefined): Promise<Answer | undefined> {
  const at = address.lastIndexOf('@')
  const [origin, version] = [address.slice(0, at), address.slice(at + 1)]
  const served = await servedAnswer(origin)
  if (!served) return undefined
  if (served.answer !== 'index') return refused(served)
  const publication = served.publications.find((entry) => entry.version === version)
  if (!publication || !output)
    return refused({
      answer: 'refusal',
      code: 'PUBLICATION_NOT_FOUND',
      message: `${origin} has no Publication ${version}.`,
    })
  const { bytes } = await encoded(origin, publication.stage)
  await writeFile(output, bytes)
  return {
    document: {
      format: 'astrale.registry-bundle',
      version: 1,
      publication: { origin, version },
      bundle: { digest: sha256(bytes), file: output },
    },
    exitCode: 0,
  }
}

function registryRead(args: readonly string[]): Promise<Answer | undefined> {
  if (args[0] === 'domain' && args[1] === 'versions' && args[2]) return versions(args[2])
  if (args[0] === '__domain-registry' && args[1] === 'bundle' && args[2]) {
    const output = args.indexOf('--output')
    return bundle(args[2], output < 0 ? undefined : args[output + 1])
  }
  return Promise.resolve(undefined)
}

const answer = await registryRead(process.argv.slice(2))
if (answer === undefined) await import(CLI)
else {
  process.stdout.write(`${JSON.stringify(answer.document)}\n`)
  process.exit(answer.exitCode)
}
