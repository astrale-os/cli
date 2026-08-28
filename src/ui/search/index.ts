import { access } from 'node:fs/promises'

import type { SearchResponse, SearchResult } from './model'

import { readUiLock } from '../lock'
import { UiError, type UiReleaseIdentity } from '../model'
import { discoverUiProject } from '../project'
import { resolveUiReleaseIdentity } from '../release'
import { loadSearchArtifacts, type SearchArtifactDependencies } from './artifacts'
import { admitSearchRequest, executeSearch } from './engine'

export type SearchUiOptions = {
  project?: string
  limit?: number
  offset?: number
}

export type SearchUiDependencies = SearchArtifactDependencies

export function nextSearchOffset(offset: number, limit: number, total: number): number | null {
  const next = offset + limit
  return next < total ? next : null
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  )
}

async function searchIdentity(
  project: string | undefined,
  fetcher: typeof fetch,
): Promise<{ identity: UiReleaseIdentity; locked: boolean }> {
  if (project) {
    const discovered = await discoverUiProject(project)
    const lock = await readUiLock(discovered.uiLockPath)
    return {
      identity: {
        version: lock.package.version,
        ref: lock.registry.ref,
        commit: lock.registry.commit,
      },
      locked: true,
    }
  }

  try {
    const discovered = await discoverUiProject()
    if (await exists(discovered.uiLockPath)) {
      const lock = await readUiLock(discovered.uiLockPath)
      return {
        identity: {
          version: lock.package.version,
          ref: lock.registry.ref,
          commit: lock.registry.commit,
        },
        locked: true,
      }
    }
  } catch (error) {
    if (error instanceof UiError && error.code !== 'UI_PROJECT_UNSUPPORTED') throw error
  }
  return { identity: await resolveUiReleaseIdentity(undefined, fetcher), locked: false }
}

function unavailable(error: unknown, locked: boolean): UiError {
  if (error instanceof UiError && error.code === 'UI_SEARCH_QUERY_INVALID') return error
  return new UiError(
    'UI_SEARCH_UNAVAILABLE',
    locked
      ? 'The project-locked Astrale UI release does not provide usable search artifacts.'
      : 'The current public Astrale UI beta does not provide usable search artifacts.',
    locked
      ? 'Run astrale ui doctor, then intentionally upgrade with astrale ui init --force.'
      : 'Retry after the Astrale UI beta release is available.',
    { cause: error },
  )
}

export async function searchUi(
  queryInput: string,
  options: SearchUiOptions = {},
  dependencies: SearchUiDependencies = {},
): Promise<SearchResponse> {
  const request = admitSearchRequest(queryInput, options)
  const fetcher = dependencies.fetcher ?? fetch
  let identity: UiReleaseIdentity
  let locked: boolean
  try {
    ;({ identity, locked } = await searchIdentity(options.project, fetcher))
  } catch (error) {
    throw unavailable(error, options.project !== undefined)
  }

  try {
    const artifacts = await loadSearchArtifacts(identity, dependencies)
    const ranked = await executeSearch(artifacts, request.query, request.offset, request.limit)
    const results: SearchResult[] = await Promise.all(
      ranked.results.map(async ({ document }) => ({
        address: document.address,
        title: document.title,
        description: document.description,
        dependencies: document.dependencies,
        code: {
          language: document.code.language,
          source: await artifacts.readCode(document.code),
        },
        ...(document.command ? { command: document.command } : {}),
        ...(document.packageImport ? { packageImport: document.packageImport } : {}),
      })),
    )
    return {
      query: request.query,
      release: { version: identity.version, commit: identity.commit },
      offset: request.offset,
      limit: request.limit,
      total: ranked.total,
      nextOffset: nextSearchOffset(request.offset, request.limit, ranked.total),
      results,
    }
  } catch (error) {
    throw unavailable(error, locked)
  }
}

export type { SearchResponse, SearchResult } from './model'
