/**
 * What a workspace Domain is on disk: its package, the Schema revision its installed SDK admits,
 * its git provenance and the Environments its Project declares. Nothing here touches the network.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SchemaRevision, StudioSchemaBundle } from '../../../shared/contracts/schema'
import type { DomainLocal, PublishedDependency } from '../../../shared/contracts/versions'
import type { DomainHandle } from '../../domain/registry'
import type { VersionsContext } from './context'

import { isSchemaRevision } from '../../../shared/contracts/schema'
import { analyzeProjectConfig } from '../../domain/registry'
import { unreadSchemaReason } from '../../introspect/bundle'
import { asJsonRecord, asString, parseJson } from '../../json'
import { gitCommit } from '../git'

/** What the sources are now: the version Publish would give them and their Schema revision. */
export type DomainSources = Pick<
  DomainLocal,
  'origin' | 'packageName' | 'declared' | 'revision' | 'revisionError' | 'dependencies'
>

export async function readSources(
  context: VersionsContext,
  handle: DomainHandle,
): Promise<DomainSources> {
  const manifest = readManifest(handle.root)
  let bundle: StudioSchemaBundle | null = null
  let readError: string | undefined
  try {
    bundle = await context.bundle(handle.id)
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error)
  }
  const revision = admittedRevision(bundle)
  const root = asJsonRecord(bundle?.schemaRoot)
  const { name, version } = await manifest
  return {
    origin: asString(root?.origin) ?? bundle?.ir?.domain ?? null,
    packageName: name,
    declared: version,
    revision,
    ...(revision === null ? { revisionError: readError ?? revisionErrorOf(bundle) } : {}),
    dependencies: dependenciesOf(root?.dependencies),
  }
}

export async function readLocal(
  context: VersionsContext,
  handle: DomainHandle,
): Promise<DomainLocal> {
  const [sources, git] = await Promise.all([readSources(context, handle), gitCommit(handle.root)])
  return {
    domainId: handle.id,
    ...sources,
    git,
    environments: analyzeProjectConfig(handle.root).environments,
  }
}

async function readManifest(
  root: string,
): Promise<{ name: string | null; version: string | null }> {
  const text = await readFile(join(root, 'package.json'), 'utf8').catch(() => undefined)
  const manifest = text === undefined ? undefined : asJsonRecord(parseJson(text))
  return { name: asString(manifest?.name) ?? null, version: asString(manifest?.version) ?? null }
}

function admittedRevision(bundle: StudioSchemaBundle | null): SchemaRevision | null {
  return bundle?.schemaMode === 'canonical-admitted' && isSchemaRevision(bundle.schemaRevision)
    ? bundle.schemaRevision
    : null
}

function revisionErrorOf(bundle: StudioSchemaBundle | null): string {
  if (bundle === null || bundle.error) return unreadSchemaReason(bundle)
  if (!bundle.depsInstalled) return "The Domain's dependencies are not installed."
  if (bundle.schemaMode === 'canonical-preview') {
    return "The Domain's installed SDK does not admit its current Schema."
  }
  return 'The Schema could not be read.'
}

/** The dependencies a Schema document declares, under their aliases, in alias order. */
export function dependenciesOf(value: unknown): Array<PublishedDependency & { alias: string }> {
  const record = asJsonRecord(value) ?? {}
  return Object.keys(record)
    .sort()
    .flatMap((alias) => {
      const entry = asJsonRecord(record[alias])
      const origin = asString(entry?.origin)
      const revision = entry?.revision
      return origin !== undefined && isSchemaRevision(revision) ? [{ alias, origin, revision }] : []
    })
}

/** The workspace Domain whose Schema has `origin`, reading a Schema only for a Domain not read yet. */
export async function findWorkspaceDomain(
  context: VersionsContext,
  origin: string,
): Promise<DomainHandle | undefined> {
  const domains = context.domains()
  const known = domains.find((handle) => handle.origin === origin)
  if (known) return known
  for (const handle of domains) {
    if (handle.origin !== undefined) continue
    if ((await readSources(context, handle)).origin === origin) return handle
  }
  return undefined
}
