import { ResponseError } from '@astrale-os/sdk/client'
import { randomUUID } from 'node:crypto'
import { readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import { AstraleError } from '../errors'
import { atomicWrite } from '../state/files'

export const ISSUE_REPORT_PATH = '/:admin.astrale.ai:function.reportIssue'

export const issueContentSchema = z.strictObject({
  title: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value.trim().length > 0),
  body: z
    .string()
    .min(1)
    .max(50_000)
    .refine((value) => value.trim().length > 0),
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

/** Persist before dispatch. This receipt log belongs only to issue reporting. */
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
  } else {
    pending = pendingSchema.parse({ version: 1, scope, payload: { ...input.content, requestId } })
    await atomicWrite(path, JSON.stringify(pending) + '\n')
  }

  let receipt: IssueReceipt
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        receipt = receiptSchema.parse(await input.send(pending.payload))
        break
      } catch (cause) {
        // Stable payload/key make a backend-unavailable retry safe even after a lost commit response.
        if (attempt !== 0 || !(cause instanceof ResponseError) || cause.code !== 5001) throw cause
      }
    }
  } catch (cause) {
    throw new AstraleError(
      'ISSUE_NOT_CONFIRMED',
      'Admin has not confirmed the report; the original request is saved.',
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
