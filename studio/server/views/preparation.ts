import { randomBytes } from 'node:crypto'

import type { ViewTargetResult } from '../../shared/types'

const PREPARATION_TTL_MS = 10 * 60_000
const MAX_PREPARATIONS = 128

export interface ViewPreparation {
  id: string
  root: string
  origin: string
  slug: string
  instance: string | null
  targetRequired: boolean
  targets: ViewTargetResult
  expiresAt: number
}

const preparations = new Map<string, ViewPreparation>()

/** Keep the exact instance and candidates shown to the user for the subsequent launch request. */
export function rememberViewPreparation(
  input: Omit<ViewPreparation, 'id' | 'expiresAt'>,
  now = Date.now(),
): ViewPreparation {
  prunePreparations(now)
  const id = randomBytes(12).toString('hex')
  const preparation = {
    ...input,
    id,
    expiresAt: now + PREPARATION_TTL_MS,
  } satisfies ViewPreparation
  preparations.set(id, preparation)
  while (preparations.size > MAX_PREPARATIONS) {
    const oldest = preparations.keys().next().value
    if (typeof oldest !== 'string') break
    preparations.delete(oldest)
  }
  return preparation
}

/** Read only a preparation created for this exact domain View route. */
export function readViewPreparation(
  id: string,
  expected: Pick<ViewPreparation, 'root' | 'origin' | 'slug'>,
  now = Date.now(),
): ViewPreparation | null {
  prunePreparations(now)
  const preparation = preparations.get(id)
  if (
    !preparation ||
    preparation.root !== expected.root ||
    preparation.origin !== expected.origin ||
    preparation.slug !== expected.slug
  ) {
    return null
  }
  return preparation
}

export function clearViewPreparations(): void {
  preparations.clear()
}

function prunePreparations(now: number): void {
  for (const [id, preparation] of preparations) {
    if (preparation.expiresAt <= now) preparations.delete(id)
  }
}
