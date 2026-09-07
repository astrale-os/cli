import type { ViewOpts } from '../../commands/view'
import type { ViewSessionRecord } from './session'

import { withClientSession } from '../../connection'
import { prepareQuery } from '../../graph'
import { readIdentities } from '../../identity/index'
import { getActive, resetInstancesMemo } from '../instance'
import { closeSession, listSessions } from './session'

export interface StudioViewTargetQuery {
  definition: string
  limit: number
}

export interface StudioViewTargetQueryResult {
  definition: string
  ok: boolean
  value: unknown | null
  detail: string
}

export interface OpenStudioViewSessionInput {
  viewPath: string
  targetRef?: string
  instance: string
  timeoutMs: number
  allowIdentity?: readonly string[]
  serveRuntime: { file: string; args: string[] }
}

interface StudioActiveInstanceDependencies {
  getActive: typeof getActive
  resetInstancesMemo: typeof resetInstancesMemo
}

/** Snapshot local identity names without exposing keys or upstream credentials to Studio. */
export async function studioViewIdentityNames(): Promise<readonly string[]> {
  return Object.keys((await readIdentities()).identities).sort()
}

/**
 * CLI-owned view operations hosted by the already long-lived Studio server.
 *
 * The Studio server is an internal mode of the exact CLI executable that launched it, so calling
 * these owners directly preserves CLI resolution, credentials, and session semantics without
 * paying for another executable startup on every HTTP request.
 */
export async function studioActiveInstanceName(
  dependencies: Partial<StudioActiveInstanceDependencies> = {},
): Promise<string | null> {
  // The Studio outlives ordinary CLI commands. Drop the process memo so an instance switch made by
  // this Studio or another terminal is visible before resolving the next view.
  const reset = dependencies.resetInstancesMemo ?? resetInstancesMemo
  reset()
  try {
    return (await (dependencies.getActive ?? getActive)()).name
  } catch {
    return null
  }
}

/** Query every target Class through one authenticated Client session. */
export async function queryStudioViewTargets(
  instance: string,
  queries: readonly StudioViewTargetQuery[],
  timeoutMs: number,
): Promise<StudioViewTargetQueryResult[]> {
  if (queries.length === 0) return []
  resetInstancesMemo()
  try {
    return await withClientSession(
      { instance, timeout: String(timeoutMs), ci: true },
      async (context) =>
        Promise.all(
          queries.map(async ({ definition, limit }) => {
            try {
              const prepared = prepareQuery({
                sources: [],
                class: definition,
                limit: String(limit),
              })
              const response = await context.graph.query(prepared.ast, { page: prepared.page })
              return {
                definition,
                ok: true,
                value: response.result,
                detail: '',
              } satisfies StudioViewTargetQueryResult
            } catch (error) {
              return failedTargetQuery(definition, error)
            }
          }),
        ),
    )
  } catch (error) {
    return queries.map(({ definition }) => failedTargetQuery(definition, error))
  }
}

/** Resolve and start one canonical CLI View session without another CLI process. */
export async function openStudioViewSession(
  input: OpenStudioViewSessionInput,
): Promise<ViewSessionRecord> {
  // The Studio E2E server can boot directly, before the CLI has generated its embedded Viewer
  // archive. Load the command owner only when a View is actually opened; the module then remains
  // cached in this long-lived process for every subsequent launch.
  const { resolveSession, startViewSession } = await import('../../commands/view')
  resetInstancesMemo()
  const options: ViewOpts = {
    instance: input.instance,
    timeout: String(input.timeoutMs),
    target: input.targetRef,
    allowIdentity: input.allowIdentity ? [...input.allowIdentity] : undefined,
    open: false,
    json: true,
    ci: true,
    serveRuntime: input.serveRuntime,
  }
  const { view } = await resolveSession(input.viewPath, options)
  if (!view) throw new Error('View resolution completed without a selected view')
  return startViewSession(view, options)
}

/** Close a session through the same CLI-owned lifecycle used by `astrale view --close`. */
export async function closeStudioViewSession(sessionId: string): Promise<void> {
  const session = (await listSessions()).find((candidate) => candidate.id === sessionId)
  if (session) await closeSession(session)
}

function failedTargetQuery(definition: string, error: unknown): StudioViewTargetQueryResult {
  return {
    definition,
    ok: false,
    value: null,
    detail:
      error instanceof Error && error.message.trim()
        ? error.message
        : 'The active instance could not be queried for view targets.',
  }
}
