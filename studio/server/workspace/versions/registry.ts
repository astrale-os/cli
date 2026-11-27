/**
 * The registry, read through the caller's `astrale` CLI session and nothing else: every read is
 * one CLI command, so the credential never leaves the CLI. Only reads are issued here.
 *
 * - `index` is `astrale domain versions <origin>`. A Publication is immutable but an index is
 *   not (a new version, a yank), so an answer is shared by concurrent readers and kept briefly.
 * - `bundleFile` is `astrale __domain-registry bundle`: the CLI writes the bundle of a
 *   Publication's release after checking it against the digest Admin published. A Publication
 *   names one release forever, so a fetched bundle is kept for the process.
 * - `domains` is the caller's own Query of Admin's `Domain` Nodes: no CLI command lists the
 *   registry's Domains.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type {
  PublicationSummary,
  PublishedDependency,
  RegistryDomain,
  RegistryDomains,
  RegistryIndex,
  Remote,
  RemoteFailure,
  RemoteStatus,
} from '../../../shared/contracts/versions'
import type { VersionsContext } from './context'

import { AdminContract } from '../../../../src/admin/contract'
import { isSchemaRevision } from '../../../shared/contracts/schema'
import { isOrigin, isVersion, REGISTRY_STEP_LIMITS_MS } from '../../../shared/contracts/versions'
import {
  asBoolean,
  asJsonArray,
  asJsonRecord,
  asString,
  parseJson,
  type JsonRecord,
} from '../../json'
import { cliFailure } from './failure'

/** How long an index answer stands before the next reader asks the registry again. */
export const INDEX_TTL_MS = 30_000
const INDEX_TIMEOUT_MS = REGISTRY_STEP_LIMITS_MS.index
const BUNDLE_TIMEOUT_MS = REGISTRY_STEP_LIMITS_MS.bundle
const QUERY_TIMEOUT_MS = REGISTRY_STEP_LIMITS_MS.index
const QUERY_PAGE = 256
const QUERY_PAGES = 8

export interface PublicationBundleFile {
  /** A file this process owns, holding the Publication's verified bundle bytes. */
  file: string
  digest: string
}

export interface RegistryReader {
  /**
   * Every Publication of `origin` the caller may read; `fresh` asks the registry again, or joins
   * the read of `origin` already asking it.
   */
  index(origin: string, options?: { fresh?: boolean }): Promise<Remote<RegistryIndex>>
  bundleFile(origin: string, version: string): Promise<Remote<PublicationBundleFile>>
  domains(): Promise<Remote<RegistryDomains>>
  /** Drop what is known of `origin`'s index, after a Publish; of every origin's, after a refresh. */
  forget(origin?: string): void
}

const MACHINE = ['--json', '--no-prompt'] as const
/** The statuses in which the registry itself answered about an index. */
const ANSWERED = new Set<RemoteStatus>(['ok', 'not-found', 'refused'])

export function createRegistryReader(context: VersionsContext): RegistryReader {
  const indexes = new Map<
    string,
    { at: number; answer: Promise<Remote<RegistryIndex>>; settled: boolean }
  >()
  const bundles = new Map<string, Promise<Remote<PublicationBundleFile>>>()
  const readAt = () => new Date(context.now()).toISOString()

  async function readIndex(origin: string): Promise<Remote<RegistryIndex>> {
    const what = `domain versions ${origin}`
    if (!isOrigin(origin))
      return { status: 'failed', message: `${origin} is not a Domain origin.`, readAt: readAt() }
    const run = await context.cli(['domain', 'versions', origin, ...MACHINE], {
      timeoutMs: INDEX_TIMEOUT_MS,
    })
    const at = readAt()
    if (run.exitCode !== 0) return cliFailure(run, what, at)
    const index = decodeRegistryIndex(parseJson(run.stdout.trim()))
    if (index === undefined || index.origin !== origin) return unreadable(what, at)
    return { status: 'ok', value: index, readAt: at }
  }

  async function fetchBundle(
    origin: string,
    version: string,
  ): Promise<Remote<PublicationBundleFile>> {
    const what = `__domain-registry bundle ${origin}@${version}`
    if (!isOrigin(origin) || !isVersion(version)) {
      return {
        status: 'failed',
        message: `${origin}@${version} names no Publication.`,
        readAt: readAt(),
      }
    }
    let file: string
    try {
      file = join(await context.scratch(), `${randomUUID()}.bundle`)
    } catch (error) {
      return {
        status: 'failed',
        message: `No scratch directory for the bundle: ${error instanceof Error ? error.message : String(error)}`,
        readAt: readAt(),
      }
    }
    const run = await context.cli(
      ['__domain-registry', 'bundle', `${origin}@${version}`, '--output', file, ...MACHINE],
      { timeoutMs: BUNDLE_TIMEOUT_MS },
    )
    const at = readAt()
    if (run.exitCode !== 0) return cliFailure(run, what, at)
    const document = asJsonRecord(parseJson(run.stdout.trim()))
    const publication = asJsonRecord(document?.publication)
    const digest = asString(asJsonRecord(document?.bundle)?.digest)
    if (
      document?.format !== 'astrale.registry-bundle' ||
      document.version !== 1 ||
      publication?.origin !== origin ||
      publication.version !== version ||
      digest === undefined
    ) {
      return unreadable(what, at)
    }
    return { status: 'ok', value: { file, digest }, readAt: at }
  }

  async function readDomains(): Promise<Remote<RegistryDomains>> {
    const status = await context.cli(['status', ...MACHINE], { timeoutMs: QUERY_TIMEOUT_MS })
    if (status.exitCode !== 0) return cliFailure(status, 'status', readAt())
    const admin = asString(asJsonRecord(asJsonRecord(parseJson(status.stdout.trim()))?.admin)?.name)
    if (admin === undefined) {
      return {
        status: 'failed',
        message: 'astrale status names no Admin target: set one up with `astrale setup`.',
        readAt: readAt(),
      }
    }
    const domains: RegistryDomain[] = []
    const what = `query --instance ${admin} --class Domain`
    let cursor: string | undefined
    for (let page = 0; page < QUERY_PAGES; page += 1) {
      const run = await context.cli(
        [
          'query',
          '--instance',
          admin,
          '--class',
          `/:${AdminContract.classes.Domain.origin}:class.${AdminContract.classes.Domain.name}`,
          '--limit',
          String(QUERY_PAGE),
          ...(cursor === undefined ? [] : ['--cursor', cursor]),
          ...MACHINE,
        ],
        { timeoutMs: QUERY_TIMEOUT_MS },
      )
      const at = readAt()
      if (run.exitCode !== 0) return cliFailure(run, what, at)
      const answer = decodeDomainPage(parseJson(run.stdout.trim()))
      if (answer === undefined) return unreadable(what, at)
      domains.push(...answer.domains)
      cursor = answer.next
      if (cursor === undefined) {
        return { status: 'ok', value: listing(domains, admin, true), readAt: at }
      }
    }
    return { status: 'ok', value: listing(domains, admin, false), readAt: readAt() }
  }

  return {
    index(origin, options = {}) {
      const held = indexes.get(origin)
      // One read of an origin at a time: a fresh read joins the one in flight, which asks the
      // registry now. `forget` (after a Publish) drops it, so the next read is a new one.
      if (held && !held.settled) return held.answer
      if (!options.fresh && held && context.now() - held.at < INDEX_TTL_MS) return held.answer
      const entry = { at: context.now(), answer: readIndex(origin), settled: false }
      indexes.set(origin, entry)
      // The registry's answer stands, including that the caller may read nothing of `origin`; a
      // read that got no answer (offline, signed out, unreadable) is retried by the next reader.
      void entry.answer.then((answer) => {
        entry.settled = true
        if (!ANSWERED.has(answer.status) && indexes.get(origin) === entry) indexes.delete(origin)
      })
      return entry.answer
    },

    bundleFile(origin, version) {
      const key = `${origin}@${version}`
      const held = bundles.get(key)
      if (held) return held
      const answer = fetchBundle(origin, version)
      bundles.set(key, answer)
      void answer.then((result) => {
        if (result.status !== 'ok' && bundles.get(key) === answer) bundles.delete(key)
      })
      return answer
    },

    domains: readDomains,

    forget(origin) {
      if (origin === undefined) indexes.clear()
      else indexes.delete(origin)
    },
  }
}

function unreadable(what: string, readAt: string): RemoteFailure {
  return {
    status: 'failed',
    message: `astrale ${what} answered a document this Studio cannot read.`,
    readAt,
  }
}

function listing(domains: RegistryDomain[], admin: string, complete: boolean): RegistryDomains {
  const sorted = [...domains].sort((left, right) => left.origin.localeCompare(right.origin))
  return { domains: sorted, source: 'admin-graph-query', admin, complete }
}

/** `RegistryIndexV1`, whole or not at all: one unreadable Publication rejects the document. */
export function decodeRegistryIndex(value: unknown): RegistryIndex | undefined {
  const document = asJsonRecord(value)
  const origin = asString(document?.origin)
  const entries = asJsonArray(document?.publications)
  if (
    document?.format !== 'astrale.registry-index' ||
    document.version !== 1 ||
    origin === undefined ||
    entries === undefined
  ) {
    return undefined
  }
  const publications: PublicationSummary[] = []
  for (const entry of entries) {
    const publication = decodePublication(asJsonRecord(entry))
    if (publication === undefined) return undefined
    publications.push(publication)
  }
  return { origin, publications }
}

function decodePublication(entry: JsonRecord | undefined): PublicationSummary | undefined {
  const version = asString(entry?.version)
  const url = asString(entry?.url)
  const releaseDigest = asString(entry?.releaseDigest)
  const buildDigest = asString(entry?.buildDigest)
  const schemaRevision = entry?.schemaRevision
  const dirty = asBoolean(entry?.dirty)
  const yanked = asBoolean(entry?.yanked)
  const publishedAt = asString(entry?.publishedAt)
  const commit = entry?.commit
  const dependencyEntries = asJsonArray(entry?.dependencies)
  if (
    version === undefined ||
    url === undefined ||
    releaseDigest === undefined ||
    buildDigest === undefined ||
    !isSchemaRevision(schemaRevision) ||
    dirty === undefined ||
    yanked === undefined ||
    publishedAt === undefined ||
    (commit !== undefined && typeof commit !== 'string') ||
    dependencyEntries === undefined
  ) {
    return undefined
  }
  const dependencies: PublishedDependency[] = []
  for (const dependency of dependencyEntries) {
    const record = asJsonRecord(dependency)
    const origin = asString(record?.origin)
    const revision = record?.revision
    if (origin === undefined || !isSchemaRevision(revision)) return undefined
    dependencies.push({ origin, revision })
  }
  return {
    version,
    url,
    releaseDigest,
    buildDigest,
    schemaRevision,
    dependencies,
    ...(commit === undefined ? {} : { commit }),
    dirty,
    yanked,
    publishedAt,
  }
}

const DOMAIN_PROPERTIES = AdminContract.properties.domain

/** One page of `astrale query --json` over Admin's `Domain` Nodes. */
export function decodeDomainPage(
  value: unknown,
): { domains: RegistryDomain[]; next?: string } | undefined {
  const document = asJsonRecord(value)
  const nodes = asJsonArray(asJsonRecord(document?.graph)?.nodes)
  if (document?.kind !== 'graph' || nodes === undefined) return undefined
  const domains: RegistryDomain[] = []
  for (const node of nodes) {
    const props = asJsonRecord(asJsonRecord(node)?.props)
    const origin = asString(props?.[DOMAIN_PROPERTIES.origin])
    if (origin === undefined) return undefined
    const name = asString(props?.[DOMAIN_PROPERTIES.name])
    const description = asString(props?.[DOMAIN_PROPERTIES.description])
    const discoveryUrl = asString(props?.[DOMAIN_PROPERTIES.discoveryUrl])
    const createdAt = asString(props?.[DOMAIN_PROPERTIES.createdAt])
    const updatedAt = asString(props?.[DOMAIN_PROPERTIES.updatedAt])
    domains.push({
      origin,
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(discoveryUrl === undefined ? {} : { discoveryUrl }),
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
    })
  }
  const next = asString(asJsonRecord(document.page)?.next)
  return next === undefined ? { domains } : { domains, next }
}
