import chalk from 'chalk'

import type { SelfExpansionMeta } from './self'

import { AstraleError } from '../errors'
import { decodeJwtExpiration, readLocalStatus, type LocalStatus } from '../lib/local-status'
import { log } from '../lib/log'

type FieldError = { path: string[]; code: string; message: string }
type InvariantError = { code: string; message: string; context?: unknown }
type SchemaUpgradeDetails = {
  readonly origin?: string
  readonly issue?: string
  readonly expected?: string
  readonly actual?: string
}

/**
 * Format and display a kernel client error.
 *
 * Handles AstraleError (CLI-local) and every error class exported by
 * @astrale-os/kernel-client: ConnectionError, DisconnectedError,
 * TimeoutError, AuthenticationError, PermissionDeniedError, NotFoundError,
 * KernelError and its subclasses (ValidationError, InvariantViolationError).
 *
 * When `debug` is true, additional diagnostic information (class name, full
 * error chain, attached url/details) is printed after the user-facing line.
 */
export async function formatKernelError(
  error: unknown,
  isRaw: boolean,
  urlArg = '',
  debug = false,
  opts: { credential?: string } = {},
): Promise<void> {
  const url =
    urlArg || (error instanceof Error ? ((error as Error & { url?: string }).url ?? '') : '')
  const localContext = await contextForError(error)
  const credentialExpiration = opts.credential ? decodeJwtExpiration(opts.credential) : null
  // Handle AstraleError (AuthError, etc.) with structured hints
  if (error instanceof AstraleError) {
    if (isRaw) {
      writeRaw({ error: error.code, message: error.message, hint: error.hint })
    } else {
      log.error(`${chalk.bold(error.code)}: ${error.message}`)
      if (error.hint) log.dim(`  ${error.hint}`)
    }
    if (debug) printDebug(error, url)
    return
  }

  if (!(error instanceof Error)) {
    if (isRaw) writeRaw({ error: 'UNKNOWN', message: String(error) })
    else log.error(String(error))
    return
  }

  const name = error.name

  switch (name) {
    case 'ConnectionError':
      if (isRaw)
        writeRaw({ error: 'CONNECTION_ERROR', message: error.message, url, context: localContext })
      else {
        log.error(`Could not connect to ${chalk.bold(url || 'kernel')}`)
        log.dim(`  ${error.message}`)
        log.dim('  Is the kernel running? Try: astrale status')
        printLocalContext(localContext)
      }
      break

    case 'DisconnectedError':
      if (isRaw) writeRaw({ error: 'DISCONNECTED', message: error.message })
      else {
        log.error('Connection closed while request was pending')
        log.dim('  The kernel may have been stopped or restarted. Retry the command.')
      }
      break

    case 'TimeoutError': {
      const timeoutMs = (error as { timeoutMs?: number }).timeoutMs
      if (isRaw) writeRaw({ error: 'TIMEOUT', message: error.message, timeoutMs })
      else {
        log.error(`Request timed out after ${timeoutMs ?? '?'}ms`)
        log.dim('  Try increasing with --timeout')
      }
      break
    }

    case 'AuthenticationError': {
      const reason = (error as { reason?: string }).reason ?? 'unknown'
      if (isRaw)
        writeRaw({
          error: 'AUTH_ERROR',
          reason,
          message: error.message,
          credential: credentialExpiration,
          context: localContext,
        })
      else {
        log.error(`Authentication failed: ${error.message}`)
        if (reason === 'missing')
          log.dim('  No credential was sent. Run: astrale identity create <name>')
        else if (reason === 'invalid')
          log.dim('  Credential is invalid — check issuer/keypair. Try: astrale identity whoami')
        else if (reason === 'expired') log.dim('  Credential expired — sign a fresh one')
        if (credentialExpiration) {
          const state = credentialExpiration.expired ? 'expired' : 'expires'
          log.dim(`  Credential ${state} at ${credentialExpiration.expiresAt}`)
        }
        printLocalContext(localContext)
      }
      break
    }

    case 'PermissionDeniedError':
      if (isRaw) writeRaw({ error: 'PERMISSION_DENIED', message: error.message })
      else {
        log.error(`Permission denied: ${error.message}`)
        log.dim('  Your identity does not have the required permissions for this operation')
      }
      break

    case 'NotFoundError': {
      const cleanMsg = stripMethodSuffix(error.message)
      const selfMeta = (error as Error & { expandedFromSelf?: SelfExpansionMeta }).expandedFromSelf
      // kernel-client maps both NOT_FOUND (the node doesn't exist) and
      // METHOD_NOT_FOUND (the method doesn't exist on a real node) to
      // `NotFoundError`. Firing the authenticated-principal hint for the
      // method case is misleading. Gate on the message referencing the
      // expanded id — node lookup errors mention `@<id>` whereas method
      // errors mention the method path.
      const selfHintApplies = selfMeta && error.message.includes(`@${selfMeta.selfId}`)
      if (isRaw) {
        const payload: Record<string, unknown> = { error: 'NOT_FOUND', message: cleanMsg }
        if (selfHintApplies) payload.expandedFromSelf = selfMeta
        writeRaw(payload)
      } else {
        log.error(`Not found: ${cleanMsg}`)
        log.dim('  Check the path/ID and that the instance is booted')
        if (selfHintApplies && selfMeta) {
          const where = selfMeta.slug ? ` on "${selfMeta.slug}"` : ''
          log.dim(
            `  @self resolved through authenticated Identity.whoami to @${selfMeta.selfId}${where}.`,
          )
          log.dim('  Check that the requested node path still exists for that principal.')
        }
      }
      break
    }

    case 'ValidationError': {
      const errors = (error as { errors?: FieldError[] }).errors ?? []
      if (isRaw) writeRaw({ error: 'VALIDATION_ERROR', message: error.message, details: errors })
      else {
        log.error('Validation Error')
        if (errors.length > 0) {
          for (const e of errors) {
            console.log(chalk.red(`  ${e.path.join('.')}: ${e.message} (${chalk.dim(e.code)})`))
          }
        } else {
          // Server often sends details in message but empty errors array
          console.log(chalk.red(`  ${error.message}`))
        }
        log.dim('  Use `astrale introspect <path>` to see the expected schema')
      }
      break
    }

    case 'InvariantViolationError': {
      const errors = (error as { errors?: InvariantError[] }).errors ?? []
      if (isRaw) writeRaw({ error: 'INVARIANT_VIOLATION', message: error.message, details: errors })
      else {
        log.error('Invariant Violation')
        for (const e of errors) {
          console.log(chalk.red(`  ${e.code}: ${e.message}`))
          if (e.context) console.log(chalk.dim(`    ${JSON.stringify(e.context)}`))
        }
      }
      break
    }

    case 'ResponseError': {
      const code = (error as { readonly code?: unknown }).code
      const reason = (error as { readonly reason?: unknown }).reason
      const reasonCode =
        reason !== null &&
        typeof reason === 'object' &&
        typeof (reason as { readonly code?: unknown }).code === 'string'
          ? (reason as { readonly code: string }).code
          : undefined
      const upgrade = schemaUpgradeDetails(reason)
      const domainAddressNotPublic = reasonCode === 'SCHEMA_DOMAIN_ADDRESS_NOT_PUBLIC'
      const displayMessage = domainAddressNotPublic
        ? 'Expose the Domain through a public HTTPS URL or public tunnel, then retry.'
        : error.message
      const hint =
        reasonCode === 'FUNCTION_INPUT_INVALID'
          ? 'Use `astrale introspect <path>` to see the callable input.'
          : upgrade !== undefined
            ? schemaUpgradeHint(upgrade)
            : undefined
      if (isRaw) {
        writeRaw({
          error: 'RESPONSE_ERROR',
          ...(code === undefined ? {} : { code }),
          message: displayMessage,
          ...(reason === undefined ? {} : { reason }),
          ...(hint === undefined ? {} : { hint }),
        })
      } else {
        log.error(
          domainAddressNotPublic
            ? `${chalk.bold('SCHEMA_DOMAIN_ADDRESS_NOT_PUBLIC')}: ${displayMessage}`
            : `${chalk.bold(code === undefined ? 'RESPONSE_ERROR' : `RESPONSE_ERROR(${String(code)})`)}: ${displayMessage}`,
        )
        if (reasonCode !== undefined && !domainAddressNotPublic) log.dim(`  reason: ${reasonCode}`)
        if (upgrade?.expected !== undefined) {
          log.dim(`  installed issuer: ${upgrade.expected}`)
        }
        if (upgrade?.actual !== undefined) {
          log.dim(`  replacement issuer: ${upgrade.actual}`)
        }
        if (hint !== undefined) log.dim(`  ${hint}`)
      }
      break
    }

    case 'KernelError': {
      const code = (error as { code?: number | string }).code ?? 'UNKNOWN'
      const type = (error as { type?: string }).type ?? 'KERNEL_ERROR'
      if (isRaw) writeRaw({ error: type, code, message: error.message })
      else log.error(`${chalk.bold(`${type}(${code})`)}: ${error.message}`)
      break
    }

    default: {
      const mapped = mapPublicError(error)
      if (isRaw) {
        writeRaw({
          error: mapped.code,
          message: mapped.message,
          ...(mapped.hint === undefined ? {} : { hint: mapped.hint }),
          ...(mapped.timeoutMs === undefined ? {} : { timeoutMs: mapped.timeoutMs }),
        })
      } else {
        log.error(`${chalk.bold(mapped.code)}: ${mapped.message}`)
        if (mapped.hint) log.dim(`  ${mapped.hint}`)
      }
    }
  }

  if (debug) printDebug(error, url)
}

/**
 * Decode the public Kernel reason without depending on a kernel-client error
 * subclass. The reason is intentionally kept intact in machine output; this
 * helper only adds the human recovery guidance that the generic ResponseError
 * message cannot provide.
 */
export function schemaUpgradeDetails(reason: unknown): SchemaUpgradeDetails | undefined {
  if (reason === null || typeof reason !== 'object') return undefined
  const value = reason as {
    readonly code?: unknown
    readonly details?: unknown
  }
  if (value.code !== 'SCHEMA_UPGRADE_INCOMPATIBLE') return undefined

  const details =
    value.details !== null && typeof value.details === 'object'
      ? (value.details as Record<string, unknown>)
      : {}
  return {
    ...(typeof details.origin === 'string' ? { origin: details.origin } : {}),
    ...(typeof details.issue === 'string' ? { issue: details.issue } : {}),
    ...(typeof details.expected === 'string' ? { expected: details.expected } : {}),
    ...(typeof details.actual === 'string' ? { actual: details.actual } : {}),
  }
}

export function schemaUpgradeHint(details: SchemaUpgradeDetails): string {
  const target = details.origin ?? '<origin>'
  const explanation =
    details.expected !== undefined && details.actual !== undefined
      ? 'A replacement cannot change an installed Domain issuer.'
      : 'The replacement changes an immutable part of the installed Domain.'
  return (
    `${explanation} If this change is intentional, first run ` +
    `\`astrale domain uninstall ${target}\`, then install it again. ` +
    'Uninstall is destructive and the Kernel may refuse it while dependents remain.'
  )
}

/** Strip internal `::methodName` suffixes from paths in error messages (e.g., "/path::listChildren" → "/path") */
export function stripMethodSuffix(msg: string): string {
  return msg.replace(/(\/[^"\s:]+)::([a-zA-Z]\w*)/g, '$1')
}

function mapPublicError(error: Error): {
  code: string
  message: string
  hint?: string
  timeoutMs?: number
} {
  const name = error.name
  if (name === 'PathError') {
    return { code: 'PATH_INVALID', message: error.message }
  }
  if (name === 'NodeUnavailableError') {
    return {
      code: 'NODE_UNAVAILABLE',
      message: error.message,
      hint: 'If this is a callable Path, use `astrale call` or `astrale introspect`.',
    }
  }
  if (name === 'AuthValueError') {
    return { code: 'AUTH_VALUE_INVALID', message: error.message }
  }
  if (name === 'ClientError' && /timed out/i.test(error.message)) {
    const timeoutMs = (error as { timeoutMs?: number }).timeoutMs
    return {
      code: 'TIMEOUT',
      message: error.message,
      hint: 'Try increasing with --timeout',
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }
  }
  if (name === 'ClientError' && /Publication discovery returned HTTP/i.test(error.message)) {
    return {
      code: 'KERNEL_DISCOVERY_FAILED',
      message: error.message,
      hint: 'Pass the Kernel issuer URL (no /invoke suffix), e.g. https://host/kernel/host',
    }
  }
  if (name === 'Error' && /unable to connect/i.test(error.message)) {
    return {
      code: 'CONNECTION_ERROR',
      message: error.message,
      hint: 'Check --url / -i and that the Kernel is reachable. Try: astrale status',
    }
  }
  return { code: name && name !== 'Error' ? name : 'UNKNOWN', message: error.message }
}

function writeRaw(payload: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify(payload) + '\n')
}

async function contextForError(error: unknown): Promise<LocalStatus | undefined> {
  if (!(error instanceof Error)) return undefined
  if (error.name !== 'AuthenticationError' && error.name !== 'ConnectionError') return undefined
  return readLocalStatus().catch(() => undefined)
}

function printLocalContext(context: LocalStatus | undefined): void {
  if (!context) return
  process.stderr.write(chalk.dim('\nContext:\n'))
  if ('error' in context.admin) {
    process.stderr.write(chalk.dim(`  admin: invalid (${context.admin.error})\n`))
  } else {
    process.stderr.write(chalk.dim(`  admin: ${context.admin.name} -> ${context.admin.url}\n`))
  }
  if (context.instance) {
    process.stderr.write(
      chalk.dim(`  instance: ${context.instance.active} -> ${context.instance.url}\n`),
    )
  } else {
    process.stderr.write(chalk.dim('  instance: none\n'))
  }
  if (context.identity) {
    const source =
      context.identity.source === 'idp'
        ? `idp:${context.identity.idp ?? 'unknown'}`
        : context.identity.source
    process.stderr.write(chalk.dim(`  identity: ${context.identity.name} [${source}]\n`))
    if (context.identity.session?.cached) {
      const state = context.identity.session.requiresLogin ? 'login required' : 'ready'
      process.stderr.write(chalk.dim(`  session: ${state}\n`))
    } else if (context.identity.source === 'idp') {
      process.stderr.write(chalk.dim('  session: not cached\n'))
    }
  } else {
    process.stderr.write(chalk.dim('  identity: none\n'))
  }
}

function printDebug(error: unknown, url: string): void {
  process.stderr.write('\n' + chalk.dim('── debug ─────────────────') + '\n')
  if (url) process.stderr.write(chalk.dim(`url:   ${url}`) + '\n')
  if (error instanceof Error) {
    process.stderr.write(chalk.dim(`class: ${error.constructor.name}`) + '\n')
    if (error.stack) process.stderr.write(chalk.dim(error.stack) + '\n')
    // Walk cause chain
    let cause = (error as Error & { cause?: unknown }).cause
    while (cause instanceof Error) {
      process.stderr.write(
        chalk.dim(`caused by: ${cause.constructor.name}: ${cause.message}`) + '\n',
      )
      if (cause.stack) process.stderr.write(chalk.dim(cause.stack) + '\n')
      cause = (cause as Error & { cause?: unknown }).cause
    }
    // Any attached fields (code, details, etc.)
    const extras: Record<string, unknown> = {}
    const bag = error as unknown as Record<string, unknown>
    for (const key of [
      'code',
      'type',
      'reason',
      'details',
      'errors',
      'data',
      'timeoutMs',
      'requestId',
    ]) {
      const v = bag[key]
      if (v !== undefined) extras[key] = v
    }
    if (Object.keys(extras).length > 0) {
      process.stderr.write(chalk.dim(`extras: ${JSON.stringify(extras, null, 2)}`) + '\n')
    }
  } else {
    process.stderr.write(chalk.dim(String(error)) + '\n')
  }
}
