import chalk from 'chalk'

import type { SelfExpansionMeta } from './expand'

import { AstraleError } from '../errors'
import { decodeJwtExpiration, readLocalStatus, type LocalStatus } from '../lib/local-status'
import { log } from '../lib/log'

type FieldError = { path: string[]; code: string; message: string }
type InvariantError = { code: string; message: string; context?: unknown }

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
  // Handle AstraleError (AuthError, ConfigError, etc.) with structured hints
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
      // `NotFoundError`. Firing the "refresh registration" hint for the
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
          const who = selfMeta.identity ?? 'your identity'
          const where = selfMeta.slug ? ` on "${selfMeta.slug}"` : ''
          log.dim(`  @self expanded to @${selfMeta.selfId} from ${who}'s registration${where}.`)
          const fixCmd = `astrale identity register${
            selfMeta.identity ? ` ${selfMeta.identity}` : ''
          }${selfMeta.slug ? ` -i ${selfMeta.slug}` : ''}`
          log.dim(`  If the node was deleted, refresh with: ${fixCmd}`)
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
        log.dim('  Use `astrale call <path> --describe` to see the expected schema')
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

    case 'KernelError': {
      const code = (error as { code?: number | string }).code ?? 'UNKNOWN'
      const type = (error as { type?: string }).type ?? 'KERNEL_ERROR'
      if (isRaw) writeRaw({ error: type, code, message: error.message })
      else log.error(`${chalk.bold(`${type}(${code})`)}: ${error.message}`)
      break
    }

    default:
      // Catch-all: include class name so diagnosis is possible even without --debug
      if (isRaw) writeRaw({ error: name || 'UNKNOWN', message: error.message })
      else log.error(`${chalk.bold(name || 'Error')}: ${error.message}`)
  }

  if (debug) printDebug(error, url)
}

/** Strip internal `::methodName` suffixes from paths in error messages (e.g., "/path::listChildren" → "/path") */
function stripMethodSuffix(msg: string): string {
  return msg.replace(/(\/[^"\s:]+)::([a-zA-Z]\w*)/g, '$1')
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
      const state = context.identity.session.expired ? 'expired' : 'active'
      const expiry = context.identity.session.expiresAt
        ? ` at ${context.identity.session.expiresAt}`
        : ''
      process.stderr.write(chalk.dim(`  session: ${state}${expiry}\n`))
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
    for (const key of ['code', 'type', 'reason', 'details', 'errors', 'timeoutMs', 'requestId']) {
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
