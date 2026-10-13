import { isSnapshotStale, ResponseError } from '@astrale-os/sdk/client'
import { acceptImmutable, BoundaryError } from '@astrale-os/sdk/value'
import { randomUUID } from 'node:crypto'
import { readFile, rm, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import { classifyFailure } from '../connection/errors'
import { AstraleError } from '../errors'
import { atomicWrite } from '../state/files'

export const ISSUE_REPORT_PATH = '/:admin.astrale.ai:function.reportIssue'

export interface IssueTextRule {
  readonly maximum: number
  /** Whether an empty or whitespace-only text is accepted, as when an edit clears the body. */
  readonly blank?: boolean
}

/** The Issue title is its Kernel `Named.name`, at most 100 characters. */
export const ISSUE_TITLE: IssueTextRule = { maximum: 100 }
/** The Issue body, as Admin's `reportIssue` input declares it. */
export const ISSUE_BODY: IssueTextRule = { maximum: 50_000 }

/**
 * Refuse a report text that cannot be sent, naming its field as the user wrote it. `missing` tells
 * how to provide a text that is empty.
 */
export function admitIssueText(
  field: string,
  value: string,
  rule: IssueTextRule,
  missing?: string,
): string {
  const problem = issueTextProblem(value, rule)
  if (problem === undefined) return value
  const empty = value.trim() === ''
  throw new AstraleError('ISSUE_INPUT_INVALID', `${field} ${problem}.`, empty ? missing : undefined)
}

function issueTextProblem(value: string, { maximum, blank = false }: IssueTextRule) {
  if (!blank && value.trim() === '') return `is empty; write 1–${count(maximum)} characters`
  if (value.length > maximum)
    return `has ${count(value.length)} characters; the limit is ${count(maximum)}`
  // Admin receives portable strings only: Unicode scalar values, without U+0000.
  if (value.includes('\u0000')) return 'contains a NUL character (U+0000), which cannot be sent'
  if (!value.isWellFormed())
    return 'contains an unpaired surrogate (invalid Unicode), which cannot be sent'
  return undefined
}

const count = (value: number) => value.toLocaleString('en-US')

export const issueContentSchema = z.strictObject({
  title: z.string(),
  body: z.string(),
  context: z.record(z.string(), z.json()).optional(),
})
const payloadSchema = issueContentSchema.extend({ requestId: z.uuid() })
const scopeSchema = z.strictObject({
  kernelIssuer: z.string().min(1),
  domainIssuer: z.string().min(1),
  principal: z.string().min(1),
})
const pendingSchema = z.strictObject({
  version: z.literal(1),
  scope: scopeSchema,
  payload: payloadSchema,
})
const receiptSchema = z.strictObject({
  id: z.string().min(1),
  reference: z.string().min(1).max(32),
})

export type IssueContent = z.infer<typeof issueContentSchema>
export type IssueScope = z.infer<typeof scopeSchema>
export type IssuePayload = z.infer<typeof payloadSchema>
export type IssueReceipt = z.infer<typeof receiptSchema>

/**
 * Persist before dispatch. This receipt log belongs only to issue reporting: it keeps a request
 * whose outcome is unknown for `--retry`, and drops one Admin refused or that can never be sent.
 */
export async function submitIssue(input: {
  readonly content?: IssueContent
  readonly retry?: string
  readonly scope: IssueScope
  readonly directory: string
  readonly send: (payload: IssuePayload) => Promise<unknown>
  readonly warn?: (message: string) => void
}): Promise<IssueReceipt> {
  if ((input.content === undefined) === (input.retry === undefined))
    throw new AstraleError(
      'ISSUE_INPUT_INVALID',
      'Provide a title and body, or --retry <request-id>.',
    )
  const requestId = input.retry ?? randomUUID()
  if (!z.uuid().safeParse(requestId).success)
    throw new AstraleError('ISSUE_RETRY_INVALID', 'The retry request ID must be a UUID.')
  const path = join(input.directory, `${requestId}.json`)
  const scope = scopeSchema.parse(input.scope)
  const forget = () =>
    rm(path, { force: true }).catch(() =>
      input.warn?.(`The local retry file of request ${requestId} could not be removed.`),
    )
  let pending: z.infer<typeof pendingSchema>
  if (input.retry !== undefined) {
    try {
      if ((await stat(path)).size > 1_000_000) throw new Error('Oversized pending report')
      pending = pendingSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch (cause) {
      throw new AstraleError(
        'ISSUE_RETRY_UNAVAILABLE',
        'The pending report could not be read.',
        'Use the request ID printed by the failed submission.',
        { cause },
      )
    }
    if (
      pending.payload.requestId !== requestId ||
      pending.scope.kernelIssuer !== scope.kernelIssuer ||
      pending.scope.domainIssuer !== scope.domainIssuer ||
      pending.scope.principal !== scope.principal
    )
      throw new AstraleError(
        'ISSUE_RETRY_SCOPE_CHANGED',
        'This report belongs to another Admin or identity.',
        'Retry with the same Admin and authenticated identity used for the original submission.',
      )
    try {
      admitPayload(pending.payload)
    } catch (refusal) {
      // Saved by an earlier CLI under looser rules: no retry can send it.
      await forget()
      throw refusal
    }
  } else {
    pending = pendingSchema.parse({ version: 1, scope, payload: { ...input.content, requestId } })
    admitPayload(pending.payload)
    await atomicWrite(path, JSON.stringify(pending) + '\n')
  }

  let receipt: IssueReceipt
  try {
    receipt = await deliver(pending.payload, input.send)
  } catch (cause) {
    if (refused(cause)) {
      // Sending the same request again is refused the same way: nothing is kept to retry.
      await forget()
      throw cause
    }
    const failure = classifyFailure(cause)
    throw new AstraleError(
      'ISSUE_NOT_CONFIRMED',
      `Admin has not confirmed the report: ${failure.message.replace(/\.$/, '')} (${failure.code}). The original request is saved.`,
      `Retry without changing its context: astrale issue --retry ${requestId}`,
      { cause },
    )
  }
  try {
    await unlink(path)
  } catch {
    input.warn?.(
      `Report ${receipt.reference} was accepted; its local retry file could not be removed.`,
    )
  }
  return receipt
}

/** Send once, and once more at once when the Kernel says the same request may run now. */
async function deliver(
  payload: IssuePayload,
  send: (payload: IssuePayload) => Promise<unknown>,
): Promise<IssueReceipt> {
  for (let attempt = 0; ; attempt++) {
    try {
      return receiptSchema.parse(await send(payload))
    } catch (cause) {
      // Stable payload/key make a backend-unavailable retry safe even after a lost commit response.
      const resend =
        cause instanceof ResponseError && (cause.code === 5001 || isSnapshotStale(cause))
      if (attempt !== 0 || !resend) throw cause
    }
  }
}

/**
 * Kernel answers after which the report may exist, or the same request may still be accepted:
 * OUTCOME_UNKNOWN (5002); BACKEND_UNAVAILABLE (5001), which Admin also answers when its own call to
 * the Issues Domain was lost; and DEADLINE_EXCEEDED (4005) and CANCELLED (4004), which can stop a
 * call after its effect.
 */
const UNSETTLED_CODES: ReadonlySet<number> = new Set([4004, 4005, 5001, 5002])

/**
 * Whether Admin refused the request itself, so that sending it again is refused the same way. Every
 * other Kernel code is a refusal. The Protocol reserves the unknown outcome for 5002, and
 * INTERNAL_ERROR (5000) projects a defect of the callable that the same request meets again, not a
 * lost answer. A failure that is no Kernel answer (transport loss, a closed session, an unreadable
 * answer) leaves the outcome unknown.
 */
function refused(cause: unknown): cause is ResponseError {
  return (
    cause instanceof ResponseError && !UNSETTLED_CODES.has(cause.code) && !isSnapshotStale(cause)
  )
}

/** Refuse, before anything is saved or sent, a request the Kernel client would never send. */
function admitPayload(payload: IssuePayload): void {
  admitIssueText('The title', payload.title, ISSUE_TITLE)
  admitIssueText('The body', payload.body, ISSUE_BODY)
  try {
    acceptImmutable(payload)
  } catch (cause) {
    if (!(cause instanceof BoundaryError)) throw cause
    throw new AstraleError('ISSUE_INPUT_INVALID', `The report cannot be sent: ${cause.message}.`)
  }
}
