/**
 * Any published version, opened read-only: the bundle its release serves (fetched and verified by
 * the CLI), decoded and admitted as that Publication's Schema, and projected into the same render
 * IR as a workspace Domain. A Publication has no sources, so its bundle has no overlay, and it is
 * marked as published so no editing surface treats it as a workspace Domain.
 *
 * A Publication names one release forever, so a projected version is kept by origin, version and
 * release digest; the decoding SDK is recorded with it.
 */
import { resolve } from 'node:path'

import type { SchemaIR } from '../../../shared/contracts/schema'
import type {
  PublicationSummary,
  PublishedSchemaBundle,
  Remote,
} from '../../../shared/contracts/versions'
import type { VersionsContext } from './context'
import type { RegistryReader } from './registry'

import { compareVersions } from '../../../../src/admin/registry/order'
import { isSchemaRevision } from '../../../shared/contracts/schema'
import { publishedDomainId, REGISTRY_STEP_LIMITS_MS } from '../../../shared/contracts/versions'
import { renderFingerprintOf } from '../../introspect/hash'
import { introspectionScheduler } from '../../introspect/scheduler'
import { asJsonArray, asJsonRecord } from '../../json'
import { findWorkspaceDomain } from './local'
import { installedSdkVersion } from './sdk'

const ISLAND_TIMEOUT_MS = REGISTRY_STEP_LIMITS_MS.judgement
const KEPT = 8

/** Studio's own checkout, used only when no workspace Domain has an installed SDK. */
const STUDIO_ROOT = resolve(import.meta.dir, '..', '..', '..')

export interface PublishedViewer {
  open(
    origin: string,
    version: string,
    options?: { fresh?: boolean },
  ): Promise<Remote<PublishedSchemaBundle>>
  /**
   * The render fingerprint of a Publication this Studio has opened since it started, read without
   * asking the registry; nothing for one it has not opened.
   */
  openedRender(origin: string, version: string): string | undefined
}

export function createPublishedViewer(
  context: VersionsContext,
  registry: RegistryReader,
): PublishedViewer {
  const kept = new Map<string, PublishedSchemaBundle>()
  /** Every Publication opened since start, by `origin@version`: its render fingerprint. */
  const opened = new Map<string, string>()
  /** The openings still running, so a reader who asks again joins one instead of a second. */
  const opening = new Map<string, Promise<Remote<PublishedSchemaBundle>>>()
  const readAt = () => new Date(context.now()).toISOString()

  /**
   * The project whose SDK decodes the Publication: the workspace Domain of its origin, else the
   * workspace Domain with the newest installed SDK, else Studio's own.
   */
  async function decodingProject(
    origin: string,
  ): Promise<{ root: string; sdk: string; domainId?: string } | null> {
    const own = await findWorkspaceDomain(context, origin)
    const ownSdk = own ? installedSdkVersion(own.root) : null
    if (own && ownSdk) return { root: own.root, sdk: ownSdk, domainId: own.id }
    const installed = context
      .domains()
      .flatMap((handle) => {
        const sdk = installedSdkVersion(handle.root)
        return sdk === null ? [] : [{ root: handle.root, sdk, domainId: handle.id }]
      })
      .sort(
        (left, right) =>
          newestFirst(left.sdk, right.sdk) || left.domainId.localeCompare(right.domainId),
      )
    if (installed[0]) return installed[0]
    const studioSdk = installedSdkVersion(STUDIO_ROOT)
    return studioSdk === null ? null : { root: STUDIO_ROOT, sdk: studioSdk }
  }

  return {
    openedRender: (origin, version) => opened.get(`${origin}@${version}`),
    async open(origin, version, options = {}) {
      const index = await registry.index(origin, { fresh: options.fresh === true })
      if (index.status !== 'ok') return index
      const publication = index.value.publications.find((entry) => entry.version === version)
      if (!publication) {
        return {
          status: 'not-found',
          message: `${origin} has no Publication ${version} this caller may read.`,
          readAt: index.readAt,
        }
      }
      const key = JSON.stringify([origin, version, publication.releaseDigest])
      const held = kept.get(key)
      // A yank is the one fact of a Publication that changes; the index read just now holds it.
      if (held) {
        const value = { ...held, publication: { ...held.publication, yanked: publication.yanked } }
        return { status: 'ok', value, readAt: held.extractedAt }
      }
      const running = opening.get(key)
      if (running) return running
      const answer = projectPublication(key, origin, version, publication)
      opening.set(key, answer)
      const settle = () => {
        if (opening.get(key) === answer) opening.delete(key)
      }
      void answer.then(settle, settle)
      return answer
    },
  }

  /** Decodes and projects one Publication the index lists, and keeps it once projected. */
  async function projectPublication(
    key: string,
    origin: string,
    version: string,
    publication: PublicationSummary,
  ): Promise<Remote<PublishedSchemaBundle>> {
    const project = await decodingProject(origin)
    if (project === null) {
      return {
        status: 'failed',
        message:
          'No installed @astrale-os/sdk can decode it: install the dependencies of a workspace Domain.',
        readAt: readAt(),
      }
    }
    const bundle = await registry.bundleFile(origin, version)
    if (bundle.status !== 'ok') return bundle

    let answer: unknown
    try {
      answer = await introspectionScheduler.schedule(
        `publication:${origin}@${version}`,
        'reader',
        () =>
          context.island(
            {
              op: 'project',
              projectRoot: project.root,
              bundleFile: bundle.value.file,
              origin,
              revision: publication.schemaRevision,
            },
            ISLAND_TIMEOUT_MS,
          ),
      ).promise
    } catch (error) {
      answer = {
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      }
    }
    const document = asJsonRecord(answer)
    const closure = asJsonArray(document?.closure)
    const ir = asJsonRecord(document?.ir) as SchemaIR | undefined
    if (
      document?.ok !== true ||
      document.op !== 'project' ||
      document.revision !== publication.schemaRevision ||
      !isSchemaRevision(document.revision) ||
      ir === undefined ||
      asJsonRecord(document.root) === undefined ||
      closure === undefined
    ) {
      const reason = asJsonRecord(document?.error)?.message
      return {
        status: 'failed',
        message:
          typeof reason === 'string'
            ? `${origin} ${version} could not be opened: ${reason}`
            : `${origin} ${version} could not be opened: the island answered nothing this Studio can read.`,
        readAt: readAt(),
      }
    }

    const extractedAt = readAt()
    const value: PublishedSchemaBundle = {
      domainId: publishedDomainId(origin, version),
      renderFingerprint: renderFingerprintOf(document.root),
      schemaMode: 'canonical-admitted',
      schemaRevision: document.revision,
      extractedBy: 'runtime-bun',
      depsInstalled: true,
      ir,
      schemaRoot: document.root,
      schemaClosure: closure,
      overlay: { handlerLinks: [], definitions: [], integrations: [], sourceSpans: {} },
      error: null,
      extractedAt,
      publication: {
        origin,
        version,
        schemaRevision: publication.schemaRevision,
        releaseDigest: publication.releaseDigest,
        bundleDigest: bundle.value.digest,
        publishedAt: publication.publishedAt,
        yanked: publication.yanked,
        decodedBy: {
          sdk: project.sdk,
          ...(project.domainId ? { domainId: project.domainId } : {}),
        },
      },
    }
    kept.delete(key)
    kept.set(key, value)
    opened.set(`${origin}@${version}`, value.renderFingerprint)
    for (const oldest of kept.keys()) {
      if (kept.size <= KEPT) break
      kept.delete(oldest)
    }
    return { status: 'ok', value, readAt: extractedAt }
  }
}

function newestFirst(left: string, right: string): number {
  try {
    return compareVersions(right, left)
  } catch {
    return 0
  }
}
