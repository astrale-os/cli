/**
 * The registry an E2E run reads. The Studio server's `astrale` (`registry-cli.ts`) answers its
 * two registry reads, `domain versions` and `__domain-registry bundle`, from one file per origin
 * that a spec writes here. An origin with no file reaches the real CLI, which this run's fresh
 * home has signed in to nothing, so it answers "signed out". Nothing reaches the network.
 */
import type { APIRequestContext } from '@playwright/test'

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { publishedDomainId } from '../shared/contracts/versions'

export const REGISTRY_DIR = join(import.meta.dirname, '..', 'test-results', 'registry')

/** The origin the fixture's Crm depends on and the Workspace does not hold. */
export const PAYMENTS = 'payments.studio-demo.astrale.ai'

/**
 * The fixture's Payments Classes at three stages, published under the origin served: before
 * Payouts were declared, as the fixture declares them (for Payments, the very Schema Crm is built
 * against), and with a Refund Class added.
 */
export type SchemaStage = 'before-payouts' | 'as-built' | 'with-refunds'

export interface ServedPublication {
  version: string
  stage: SchemaStage
  publishedAt: string
  yanked?: boolean
}

/** What the registry answers of one origin. */
export type RegistryAnswer =
  /** its Publications, newest first, as the registry lists them */
  | { answer: 'index'; publications: ServedPublication[] }
  /** a refusal, as the CLI composes it for a coded registry error */
  | { answer: 'refusal'; code: string; message: string; details?: Record<string, unknown> }
  /** a document no Studio can read */
  | { answer: 'unreadable' }

export const registryFile = (origin: string): string => join(REGISTRY_DIR, `${origin}.json`)

/** Serve these origins from now on, each as it says. */
export async function serveRegistry(answers: Record<string, RegistryAnswer>): Promise<void> {
  await mkdir(REGISTRY_DIR, { recursive: true })
  for (const [origin, answer] of Object.entries(answers))
    await writeFile(registryFile(origin), JSON.stringify(answer))
}

/**
 * Serve nothing any more, and make the server forget what it was served: a fresh read of each
 * origin now reaches the real CLI, whose "signed out" the server does not keep.
 */
export async function clearRegistry(
  request: APIRequestContext,
  origins: readonly string[],
): Promise<void> {
  await rm(REGISTRY_DIR, { recursive: true, force: true })
  for (const origin of origins) {
    const id = publishedDomainId(origin, '0.0.0')
    await request.get(`/api/domain/${encodeURIComponent(id)}/bundle?fresh=1`)
  }
}
