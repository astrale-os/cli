import type {
  Bundle,
  Catalogue,
  CatalogueEntry,
  GlyphSet,
  Iconography,
  Key,
  Meaning,
  PolicyDocument,
  Rule,
} from '@astrale-os/visual'
import type { StudioSchemaBundle } from '@shared/contracts/schema'

import {
  canonical,
  GLYPHS,
  ICONOGRAPHY,
  iconographyOfBundle,
  KERNEL_TERMINOLOGIES,
  meaningOf,
  policyDocumentsOfBundle,
  schemaOfBundle,
} from '@astrale-os/visual'

/**
 * A Domain's rules as `@astrale-os/visual` reads them, from the Bundle the installed SDK admitted:
 * the Studio's `schemaRoot` with its `schemaClosure`. The catalogue is `catalogueOfBundle`'s, built
 * from the package's own parts (its Schema, Terminologies, Iconography and Policy documents), with
 * one difference: a Policy use the reader cannot read costs that use alone, where the package's
 * catalogue refuses every use for one.
 */

/** What the Studio's bundle reply carries that a rule reader reads. */
export type RulesSource = Pick<
  StudioSchemaBundle,
  'domainId' | 'schemaMode' | 'schemaRoot' | 'schemaClosure'
>

/** Why a rule, or every rule of a Domain, has no reading. */
export type UnreadReason =
  /** The Studio holds no canonical Schema the installed SDK admitted for the Domain. */
  | 'not-admitted'
  /** The admitted root came without the Schemas it depends on, and the rule names one of them. */
  | 'no-closure'
  /** A Policy the rule checks is in no Schema of the Bundle. */
  | 'missing-policy'
  /** The reader cannot read the rule: the detail is its own message. */
  | 'refused'
  /** The Rules language has no form for a declaration the Schema makes. */
  | 'not-expressible'
  /** A Policy of the root that no use checks: the reader reads a Policy over the objects a use checks it on. */
  | 'unchecked'
  /** A Policy another Domain declares: the catalogue of that Domain reads its definition. */
  | 'foreign'
  /** A use the reader enumerates no rule for. */
  | 'not-enumerated'

export interface Unread {
  readonly status: 'unread'
  readonly reason: UnreadReason
  readonly detail: string
}

export const unread = (reason: UnreadReason, detail: string): Unread => ({
  status: 'unread',
  reason,
  detail,
})

/** One Policy use of the root, in the Bundle's order: its rule, or why it has none. */
export interface PolicyUseReading {
  /** Unique within the Domain, as the package's catalogue names the entry: `Task · read`, `Task · read (2)`. */
  readonly id: string
  readonly document: PolicyDocument
  readonly reading: { readonly status: 'read'; readonly rule: Rule } | Unread
}

export interface DomainCatalogue {
  readonly status: 'read'
  readonly origin: string
  /** The package's view of the Domain: its entries are the uses it reads. */
  readonly catalogue: Catalogue
  readonly uses: readonly PolicyUseReading[]
  /** Whether the Studio sent the root's dependency Schemas with it. */
  readonly closure: boolean
}

const known = new WeakMap<RulesSource, DomainCatalogue | Unread>()

/** A bundle reply's catalogue, read once per reply. */
export function catalogueOf(source: RulesSource): DomainCatalogue | Unread {
  let found = known.get(source)
  if (found === undefined) {
    found = read(source)
    known.set(source, found)
  }
  return found
}

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The Bundle a reply's admitted Schema forms: the root with the closure it was admitted with. */
export function bundleOf(source: RulesSource): Bundle | undefined {
  if (source.schemaMode !== 'canonical-admitted' || source.schemaRoot === undefined)
    return undefined
  // The server sends both only after `isCanonicalDomainSchemaV1` accepted each document.
  return {
    format: 'astrale.dsl.bundle',
    version: 'v1',
    root: source.schemaRoot,
    closure: source.schemaClosure ?? [],
  } as unknown as Bundle
}

function read(source: RulesSource): DomainCatalogue | Unread {
  const bundle = bundleOf(source)
  if (bundle === undefined)
    return unread(
      'not-admitted',
      source.schemaMode === 'canonical-admitted'
        ? 'The Studio sent no canonical Schema with this Domain, so there is none to read its rules from.'
        : source.schemaMode === 'canonical-preview'
          ? 'The installed SDK did not admit this Schema: a preview is drawn, but its rules are read only from an admitted Schema.'
          : 'The Studio could not extract a canonical Schema for this Domain, so there is none to read its rules from.',
    )
  const closure = source.schemaClosure !== undefined
  const failed = (error: unknown): Unread =>
    unread(closure ? 'refused' : 'no-closure', messageOf(error))
  let documents: PolicyDocument[]
  let schema: Catalogue['words']['schema']
  let icons: { readonly iconography: Iconography; readonly glyphs: GlyphSet }
  try {
    documents = policyDocumentsOfBundle(bundle)
    schema = schemaOfBundle(bundle)
    icons = iconsOf(bundle)
  } catch (error) {
    return failed(error)
  }

  const entries: CatalogueEntry[] = []
  const read: {
    id: string
    document: PolicyDocument
    made?: { entry: CatalogueEntry; meaning: Meaning; digest: string }
    failure?: Unread
  }[] = []
  const ranks = new Map<string, number>()
  for (const document of documents) {
    const rank = (ranks.get(document.name) ?? 0) + 1
    ranks.set(document.name, rank)
    const id = rank === 1 ? document.name : `${document.name} (${rank})`
    const missing = missingPolicy(document)
    if (missing !== undefined) {
      read.push({
        id,
        document,
        failure: unread('missing-policy', `${missing} is in no Schema of the Bundle.`),
      })
      continue
    }
    try {
      const source = { language: 'policy', document } as const
      const written = meaningOf(source, schema)
      const { kind } = written.frame
      if (kind === 'unknown') throw new Error(`${document.name} reads as no rule the reader knows.`)
      const entry: CatalogueEntry = {
        id,
        title: document.name,
        family: kind,
        source,
        ...(document.description === undefined ? {} : { purpose: document.description }),
      }
      entries.push(entry)
      read.push({ id, document, made: { entry, ...canonical(written, schema) } })
    } catch (error) {
      read.push({ id, document, failure: failed(error) })
    }
  }

  const origin = bundle.root.origin
  const catalogue: Catalogue = {
    id: source.domainId,
    origin,
    words: { schema, terminologies: KERNEL_TERMINOLOGIES },
    iconography: icons.iconography,
    glyphs: icons.glyphs,
    entries,
  }
  return {
    status: 'read',
    origin,
    catalogue,
    closure,
    uses: read.map(({ id, document, made, failure }) => ({
      id,
      document,
      reading: failure ?? { status: 'read', rule: { catalogue, ...made! } },
    })),
  }
}

/**
 * The glyphs of a Bundle's icons with the reader's own `relation` beside them, as the package's
 * catalogue draws them: a Domain draws no Edge icon, so every Edge named by its name takes it.
 */
function iconsOf(bundle: Bundle): {
  readonly iconography: Iconography
  readonly glyphs: GlyphSet
} {
  const { iconography, glyphs } = iconographyOfBundle(bundle)
  const relation = ICONOGRAPHY.glyphs['relation']!
  return {
    iconography: { ...iconography, glyphs: { relation, ...iconography.glyphs } },
    glyphs: { [relation]: GLYPHS[relation]!, ...glyphs },
  }
}

/** A Schema reference, as the Bundle writes one. */
interface Ref {
  readonly origin: string
  readonly kind: string
  readonly name: string
}

const isPolicyRef = (value: object): value is Ref => {
  const ref = value as Partial<Ref>
  return ref.kind === 'policy' && typeof ref.name === 'string' && typeof ref.origin === 'string'
}

/** The Studio key of a Schema reference (`schemaRefKey`): `<origin>:<kind>.<name>`. */
export const refKey = (ref: Ref): Key => `${ref.origin}:${ref.kind}.${ref.name}`

/** Every Policy a value names, at any depth, by its key. */
export function policyRefsIn(value: unknown, into: Set<Key> = new Set()): Set<Key> {
  if (Array.isArray(value)) for (const each of value) policyRefsIn(each, into)
  else if (value !== null && typeof value === 'object') {
    if (isPolicyRef(value)) into.add(refKey(value))
    else for (const each of Object.values(value)) policyRefsIn(each, into)
  }
  return into
}

/** The first Policy a use checks, itself or through another, that the document does not carry. */
function missingPolicy(document: PolicyDocument): Key | undefined {
  const named = policyRefsIn(document.use)
  for (const definition of Object.values(document.policies)) policyRefsIn(definition, named)
  for (const key of named) if (!(key in document.policies)) return key
  return undefined
}
