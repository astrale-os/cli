/**
 * The status of a remote fact, from what the `astrale` CLI answered. Only the CLI's machine
 * error documents are read: a registry command's CT29 document `{ error: { code, message } }` on
 * stdout, or any other command's one JSON line `{ error: CODE, message }` on stderr. Raw
 * diagnostics are never relayed, so nothing the CLI did not compose for a caller reaches one.
 */
import type { RemoteFailure } from '../../../shared/contracts/versions'
import type { CapturedProcess } from '../../process'

import { asJsonRecord, asString, parseJson } from '../../json'

export type FailureStatus = RemoteFailure['status']

/** One refusal the CLI composed for its caller. */
export interface CliRefusal {
  code: string
  message: string
  details?: Record<string, unknown>
}

/** No usable session: the caller must sign in again. */
const SIGNED_OUT = new Set([
  'AUTH_ERROR',
  'NO_IDENTITY',
  'IDENTITY_KEY_MISSING',
  'IDENTITY_KEYPAIR_INCOMPLETE',
  'IDP_SESSION_MISSING',
  'IDP_SESSION_INVALID',
  'IDP_SESSION_NO_REFRESH_TOKEN',
  'IDP_SESSION_COPIED',
  'IDP_ID_TOKEN_MISSING',
  'IDP_TOKEN_REFUSED',
  'IDP_LOGIN_FAILED',
  'TOKEN_EXCHANGE_SOURCE_INVALID',
  'TOKEN_EXCHANGE_SOURCE_EXPIRED',
])

/** Admin, the registry, a deployment or the identity provider could not be reached. */
const OFFLINE = new Set([
  'CONNECTION_ERROR',
  'TRANSPORT_ERROR',
  'ADMIN_BACKEND_UNAVAILABLE',
  'IDP_DISCOVERY_FAILED',
  'INSTANCE_DISCOVERY_FAILED',
  'TOKEN_EXCHANGE_DISCOVERY_FAILED',
  'TOKEN_EXCHANGE_UNAVAILABLE',
  'PUBLICATION_RELEASE_UNREACHABLE',
])

const NOT_FOUND = new Set(['REGISTRY_DOMAIN_NOT_FOUND', 'PUBLICATION_NOT_FOUND'])

/** The CLI could not run the command at all, or could not read what it was answered. */
const FAILED = new Set(['USAGE_ERROR', 'UNEXPECTED_ERROR', 'MISSING_ARG', 'INVALID_INPUT'])

/**
 * The status a coded refusal stands for. `REGISTRY_UNAVAILABLE` is offline when nothing answered
 * (`transport`) or the registry asks for a rerun (`retryable`), and a failure when the CLI could
 * not read the answer. Any other code is the registry's or the CLI's refusal of this read.
 */
export function statusOfRefusal(refusal: CliRefusal): FailureStatus {
  const { code, details } = refusal
  if (SIGNED_OUT.has(code)) return 'signed-out'
  if (OFFLINE.has(code)) return 'offline'
  if (NOT_FOUND.has(code)) return 'not-found'
  if (FAILED.has(code)) return 'failed'
  if (code === 'REGISTRY_UNAVAILABLE') {
    return details?.reason === 'transport' || details?.retryable === true ? 'offline' : 'failed'
  }
  return 'refused'
}

/** The CT29 error document a registry command prints on stdout in machine mode. */
export function registryRefusal(stdout: string): CliRefusal | undefined {
  const error = asJsonRecord(asJsonRecord(parseJson(stdout.trim()))?.error)
  const code = asString(error?.code)
  const message = asString(error?.message)
  if (!code || message === undefined) return undefined
  const details = asJsonRecord(error?.details)
  return { code, message, ...(details ? { details } : {}) }
}

/** The one JSON refusal line any other command prints on stderr in machine mode; the last wins. */
export function commandRefusal(stderr: string): CliRefusal | undefined {
  const lines = stderr.split(/\r?\n/).filter((line) => line.trim().startsWith('{'))
  for (const line of lines.reverse()) {
    const document = asJsonRecord(parseJson(line.trim()))
    const code = asString(document?.error)
    const message = asString(document?.message)
    if (!code || message === undefined) continue
    const hint = asString(document?.hint)
    const details = asJsonRecord(document?.details)
    return {
      code,
      message: hint ? `${message} ${hint}` : message,
      ...(details ? { details } : {}),
    }
  }
  return undefined
}

/**
 * Why a CLI run produced no fact: its refusal when it composed one, otherwise what the Studio
 * observed of the run itself (it could not start, it ran out of time, it answered nothing
 * readable). `what` names the read, as in "domain versions issues.astrale.ai".
 */
export function cliFailure(run: CapturedProcess, what: string, readAt: string): RemoteFailure {
  const refusal = registryRefusal(run.stdout) ?? commandRefusal(run.stderr)
  if (refusal) {
    return {
      status: statusOfRefusal(refusal),
      code: refusal.code,
      message: refusal.message,
      readAt,
    }
  }
  if (run.spawnError !== undefined) {
    return {
      status: 'failed',
      message: `astrale ${what} could not start: ${run.spawnError}`,
      readAt,
    }
  }
  if (run.timedOut) {
    return { status: 'offline', message: `astrale ${what} gave no answer in time.`, readAt }
  }
  return {
    status: 'failed',
    message: `astrale ${what} answered nothing this Studio can read (exit ${run.exitCode}).`,
    readAt,
  }
}
