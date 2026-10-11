import type { SearchResponse, SearchResult } from './model'

import { exists } from '../files'
import { lockedIdentity, readUiLock } from '../lock'
import { UiError, type UiReleaseIdentity } from '../model'
import { discoverUiProject } from '../project'
import { resolveUiReleaseIdentity } from '../release'
import { loadSearchArtifacts, type SearchArtifactDependencies } from './artifacts'
import { admitSearchRequest, executeSearch } from './engine'

type SearchUiOptions = { project?: string; limit?: number; offset?: number }

async function searchIdentity(
  project: string | undefined,
  fetcher: typeof fetch,
): Promise<{ identity: UiReleaseIdentity; locked: boolean }> {
  if (project) {
    const discovered = await discoverUiProject(project)
    return { identity: lockedIdentity(await readUiLock(discovered.uiLockPath)), locked: true }
  }

  try {
    const discovered = await discoverUiProject()
    if (await exists(discovered.uiLockPath)) {
      return { identity: lockedIdentity(await readUiLock(discovered.uiLockPath)), locked: true }
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
  dependencies: SearchArtifactDependencies = {},
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
      nextOffset:
        request.offset + request.limit < ranked.total ? request.offset + request.limit : null,
      results,
    }
  } catch (error) {
    throw unavailable(error, locked)
  }
}

export type { SearchResponse, SearchResult } from './model'
