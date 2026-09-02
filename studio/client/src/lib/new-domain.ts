/**
 * new-domain.ts — what happens between "send" and a domain with an agent
 * working in it.
 *
 * A domain has to EXIST before anything can be said to it: its folder is
 * scaffolded, its dependencies installed, its schema booted. So the first
 * message of a new domain is not one call but three, in an order that cannot
 * move — create the domain under the name that was typed, give it the files,
 * then hand it the message exactly as the domain's own composer would.
 *
 * The order is also where it can fail, and each failure means something
 * different. Nothing was created → nothing is lost, the composer keeps
 * everything and says why. The domain exists but the briefing did not land →
 * the domain is real and hiding it would be worse, so the caller goes there and
 * carries the message with it (`unsent`), one keystroke from being sent again.
 */
import type { AgentRun } from '@shared/types'

/** create-astrale-domain's slug shape (kept in sync with the server guard). */
const SLUG = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const MAX_NAME = 64

/** A name as the studio reads it: what it will be called, and what is wrong with it. */
export interface NameReading {
  /** the name, lowercased and trimmed — what the server is asked for */
  slug: string
  valid: boolean
  /** what is wrong, said to the person typing — null while nothing is typed yet */
  error: string | null
}

export function readName(raw: string): NameReading {
  const slug = raw.trim().toLowerCase()
  const valid = !!slug && slug.length <= MAX_NAME && SLUG.test(slug)
  return { slug, valid, error: !slug || valid ? null : errorFor(slug) }
}

function errorFor(slug: string): string {
  if (slug.length > MAX_NAME) return `Keep it under ${MAX_NAME} characters.`
  return 'Use lowercase letters, digits, dots and dashes — starting and ending on a letter or digit.'
}

/** Where the send has got to. Each step is worth saying: none of them is instant. */
export type NewDomainPhase = 'idle' | 'creating' | 'attaching' | 'briefing'

export interface NewDomainRequest {
  name: string
  /** the first message, as typed — a domain is asked for, not just named */
  message: string
  /** files staged before the domain existed; uploaded to it the moment it does */
  files: File[]
}

/** The three calls, injected so the order can be tested without a server. */
export interface NewDomainPorts {
  createDomain: (
    name: string,
  ) => Promise<{ ok: boolean; id?: string; origin?: string; error?: string }>
  uploadDocuments: (id: string, files: File[]) => Promise<unknown>
  submit: (id: string, message: string) => Promise<{ run?: AgentRun; error?: string }>
  onPhase: (phase: NewDomainPhase) => void
}

export interface NewDomainOutcome {
  /** set from the moment the domain exists — the point of no return */
  id?: string
  origin?: string
  /** the turn the first message started, when one did */
  run?: AgentRun
  error?: string
  /** the message that never left, for the domain's own composer to pick up */
  unsent?: string
}

function reason(error: unknown): string {
  return (error as Error)?.message ?? String(error)
}

/**
 * Create the domain, then brief the agent in it — one send, in that order.
 *
 * It takes both halves: a name, and what the domain is for. A scaffold nobody
 * asked anything of is a folder, and the point of coming in through a composer
 * is that the turn starts with it — so a missing message is refused here rather
 * than quietly creating half of what was meant. The send ends with the same
 * call the domain's own composer makes, so what happens next is a conversation
 * like any other.
 */
export async function createDomainWithBrief(
  ports: NewDomainPorts,
  request: NewDomainRequest,
): Promise<NewDomainOutcome> {
  const { slug, valid, error } = readName(request.name)
  if (!valid) return { error: error ?? 'Give the domain a name.' }
  const message = request.message.trim()
  if (!message) return { error: 'Tell the agent what this domain is for.' }

  ports.onPhase('creating')
  let created: Awaited<ReturnType<NewDomainPorts['createDomain']>>
  try {
    created = await ports.createDomain(slug)
  } catch (failure) {
    return { error: reason(failure) }
  }
  if (!created.ok || !created.id) {
    return { error: created.error || 'Could not create the domain — check the studio logs.' }
  }
  const landed = { id: created.id, origin: created.origin }

  if (request.files.length) {
    ports.onPhase('attaching')
    try {
      await ports.uploadDocuments(landed.id, request.files)
    } catch (failure) {
      // The domain is real; only its context is missing. Hand the message back
      // rather than send a turn that was meant to read files it does not have.
      return {
        ...landed,
        error: `The files could not be added — ${reason(failure)}`,
        unsent: message,
      }
    }
  }

  ports.onPhase('briefing')
  try {
    const result = await ports.submit(landed.id, message)
    if (result.error) return { ...landed, error: result.error, unsent: message }
    return { ...landed, run: result.run }
  } catch (failure) {
    return { ...landed, error: reason(failure), unsent: message }
  }
}
