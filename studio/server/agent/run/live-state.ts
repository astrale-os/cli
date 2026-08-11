import type { AgentRun } from '../../../shared/types'

import { readLastRun } from './transcript'

const runs = new Map<string, AgentRun>()
const controllers = new Map<string, AbortController>()
const cancellation = new Map<string, () => void>()
const starting = new Set<string>()
const hydrated = new Set<string>()

export function currentRun(domainId: string): AgentRun | undefined {
  return runs.get(domainId)
}

export function setCurrentRun(run: AgentRun): void {
  runs.set(run.domainId, run)
}

export function isRunActive(domainId: string): boolean {
  const status = runs.get(domainId)?.status
  return starting.has(domainId) || status === 'running' || status === 'queued'
}

/** Reserve a domain synchronously before asynchronous run preparation begins. */
export function reserveRun(domainId: string): AbortController | null {
  if (isRunActive(domainId)) return null
  const controller = new AbortController()
  starting.add(domainId)
  controllers.set(domainId, controller)
  return controller
}

export function releasePreparation(domainId: string, controller: AbortController): void {
  starting.delete(domainId)
  if (controllers.get(domainId) === controller && !isRunActive(domainId)) {
    controllers.delete(domainId)
    cancellation.delete(domainId)
  }
}

export function attachCancellation(
  domainId: string,
  controller: AbortController,
  cancel: () => void,
): void {
  if (controllers.get(domainId) === controller) cancellation.set(domainId, cancel)
}

export function releaseController(domainId: string, controller: AbortController): void {
  if (controllers.get(domainId) === controller) {
    controllers.delete(domainId)
    cancellation.delete(domainId)
  }
}

export function cancelActiveRun(domainId: string): boolean {
  const controller = controllers.get(domainId)
  if (!controller) return false
  controller.abort()
  try {
    cancellation.get(domainId)?.()
  } catch {
    /* cancellation must still succeed */
  }
  return true
}

export function hydrateRun(domainId: string, root: string): void {
  if (hydrated.has(domainId) || runs.has(domainId)) return
  hydrated.add(domainId)
  const last = readLastRun(domainId, root)
  if (last) runs.set(domainId, last)
}
