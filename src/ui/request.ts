import { createHash } from 'node:crypto'

import { UiError } from './model'

export const UI_REQUEST_PATH = '/:ui.astrale.ai:function.request'

export const UI_REQUEST_LIMITS = {
  queryCodePoints: 512,
} as const

export type UiRequestInput = {
  readonly intent: string
  readonly idempotencyKey: string
}

export type UiRequestResult =
  | {
      readonly state: 'submitted'
      readonly requestId: string
      readonly collaborationUrl: string
    }
  | {
      readonly state: 'pending' | 'outcome-unknown' | 'failed' | 'conflict'
      readonly requestId: string
    }

export type UiRequestSubmitter = (input: UiRequestInput) => Promise<unknown>

function normalizeQuery(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim()
}

export function createUiRequestInput(query: string): UiRequestInput {
  const intent = normalizeQuery(query)
  if (!intent || [...intent].length > UI_REQUEST_LIMITS.queryCodePoints) {
    throw new UiError(
      'UI_REQUEST_QUERY_INVALID',
      `UI request intent must contain 1-${UI_REQUEST_LIMITS.queryCodePoints} Unicode characters.`,
      'Describe the desired UI outcome and observable behavior in one bounded request.',
    )
  }
  const digest = createHash('sha256').update(intent, 'utf8').digest('hex')
  return Object.freeze({ intent, idempotencyKey: `ui-request:v1:${digest}` })
}

export async function requestUi(
  query: string,
  submit: UiRequestSubmitter,
): Promise<UiRequestResult> {
  return admitUiRequestResult(await submit(createUiRequestInput(query)))
}

export function admitUiRequestResult(value: unknown): UiRequestResult {
  if (!isRecord(value) || typeof value.requestId !== 'string' || value.requestId.length === 0) {
    throw unavailable()
  }
  const keys = Object.keys(value).sort()
  if (value.state === 'submitted') {
    if (
      keys.join(',') !== 'collaborationUrl,requestId,state' ||
      typeof value.collaborationUrl !== 'string' ||
      !isHttpsUrl(value.collaborationUrl)
    ) {
      throw unavailable()
    }
    return Object.freeze({
      state: value.state,
      requestId: value.requestId,
      collaborationUrl: value.collaborationUrl,
    })
  }
  if (
    keys.join(',') !== 'requestId,state' ||
    !['pending', 'outcome-unknown', 'failed', 'conflict'].includes(String(value.state))
  ) {
    throw unavailable()
  }
  return Object.freeze({
    state: value.state as Exclude<UiRequestResult['state'], 'submitted'>,
    requestId: value.requestId,
  })
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === 'https:' &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.href === value
    )
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unavailable(): UiError {
  return new UiError(
    'UI_REQUEST_UNAVAILABLE',
    'The UI Domain returned an invalid request receipt.',
    'Verify that the current Instance has a compatible ui.astrale.ai Domain installed.',
  )
}
