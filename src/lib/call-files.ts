import { AstraleError } from '../errors'
import { acceptMediaType, formatBytes, type LocalFile } from './upload'

/** One `--file <field>=<file>`: where the receipt goes in the call input, and which file. */
export interface FileInput {
  /** The JSON Pointer the receipt is written at, e.g. `/balance` or `/attachments/0`. */
  readonly pointer: string
  readonly path: string
}

/** What a callable input declares about a file field; each bound is optional. */
export interface FileContract {
  readonly maxBytes?: number
  readonly mediaTypes?: readonly string[]
}

const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/u
const POINTER = /^(?:\/(?:[^~/]|~[01])*)+$/u

/**
 * Parse `<field>=<file>`. The field is a top-level input key, as for key=value params, or a JSON
 * Pointer into the input (`/attachments/0`, `/items/-` to append). The first `=` separates them.
 */
export function parseFileInput(spec: string): FileInput {
  const separator = spec.indexOf('=')
  const field = separator < 0 ? '' : spec.slice(0, separator)
  const path = separator < 0 ? '' : spec.slice(separator + 1)
  if (field === '' || path === '') {
    throw new AstraleError(
      'FILE_INPUT_INVALID',
      `--file "${spec}" must be <field>=<file>.`,
      'Name the input field and the file, e.g. --file balance=./balance.csv or --file /attachments/0=./a.pdf',
    )
  }
  if (field.startsWith('/')) {
    if (!POINTER.test(field)) {
      throw new AstraleError(
        'FILE_INPUT_INVALID',
        `--file field "${field}" is not a JSON Pointer.`,
        'Escape "~" as ~0 and "/" inside a key as ~1.',
      )
    }
    return Object.freeze({ pointer: field, path })
  }
  if (!FIELD_KEY.test(field)) {
    throw new AstraleError(
      'FILE_INPUT_INVALID',
      `--file field "${field}" is not an input key.`,
      'Use a top-level key (letters, digits, _ and -) or a JSON Pointer such as /attachments/0.',
    )
  }
  return Object.freeze({ pointer: `/${field}`, path })
}

function tokens(pointer: string): string[] {
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
}

const INDEX = /^(?:0|[1-9][0-9]*)$/u

/**
 * Write `value` at `pointer` in `input`, creating the objects and arrays on the way: a numeric
 * token or `-` creates an array, any other token an object. An existing value is never replaced.
 */
export function injectAt(
  input: Record<string, unknown>,
  pointer: string,
  value: unknown,
): Record<string, unknown> {
  const path = tokens(pointer)
  let container: unknown = input
  for (const [index, token] of path.entries()) {
    const last = index === path.length - 1
    const next = path[index + 1]
    const create = () => (next !== undefined && (next === '-' || INDEX.test(next)) ? [] : {})
    if (Array.isArray(container)) {
      if (token !== '-' && !INDEX.test(token)) {
        throw conflict(pointer, `"${token}" is not an index of the array it names`)
      }
      const position = token === '-' ? container.length : Number(token)
      if (position > container.length) {
        throw conflict(
          pointer,
          `index ${position} is past the end of an array of ${container.length}`,
        )
      }
      if (last) {
        if (container[position] !== undefined) throw conflict(pointer, 'it already holds a value')
        container[position] = value
        return input
      }
      container[position] ??= create()
      container = container[position]
    } else if (container !== null && typeof container === 'object') {
      const record = container as Record<string, unknown>
      if (last) {
        if (Object.hasOwn(record, token)) throw conflict(pointer, 'it already holds a value')
        record[token] = value
        return input
      }
      if (!Object.hasOwn(record, token)) record[token] = create()
      container = record[token]
    } else {
      throw conflict(pointer, 'it goes through a value that is not an object or an array')
    }
  }
  return input
}

function conflict(pointer: string, why: string): AstraleError {
  return new AstraleError(
    'FILE_INPUT_CONFLICT',
    `Cannot put a file receipt at ${pointer}: ${why}.`,
    'Leave that field out of the other params; --file fills it with the receipt.',
  )
}

/** The value schema the callable input declares at `pointer`, when its shape says so. */
export function schemaAt(schema: unknown, pointer: string): unknown {
  let current: unknown = schema
  for (const token of tokens(pointer)) {
    if (!isRecord(current)) return undefined
    const properties = current.properties
    if (isRecord(properties) && isRecord(properties[token])) {
      current = properties[token]
      continue
    }
    if (token === '-' || INDEX.test(token)) {
      const prefix = current.prefixItems
      if (Array.isArray(prefix) && token !== '-' && isRecord(prefix[Number(token)])) {
        current = prefix[Number(token)]
        continue
      }
      if (isRecord(current.items)) {
        current = current.items
        continue
      }
    }
    if (isRecord(current.additionalProperties)) {
      current = current.additionalProperties
      continue
    }
    return undefined
  }
  return current
}

/**
 * The file contract a value schema declares, or undefined when it declares none. Kernels that
 * release a DSL `file()` value kind mark it in introspection; until then a file field is a plain
 * string that carries the receipt, and nothing is checked before upload.
 */
export function fileContract(schema: unknown): FileContract | undefined {
  if (!isRecord(schema)) return undefined
  const marker = schema['x-astrale-file']
  const declared = isRecord(marker) || marker === true || schema['x-astrale-value-kind'] === 'file'
  if (!declared) return undefined
  const source = isRecord(marker) ? marker : schema
  const maxBytes = source.maxBytes
  const mediaTypes = source.mediaTypes
  return Object.freeze({
    ...(typeof maxBytes === 'number' && Number.isFinite(maxBytes) ? { maxBytes } : {}),
    ...(Array.isArray(mediaTypes) && mediaTypes.every((item) => typeof item === 'string')
      ? { mediaTypes: Object.freeze([...(mediaTypes as string[])]) }
      : {}),
  })
}

/** Refuse, before any byte is sent, a file the callable's declared file field would refuse. */
export function checkFileContract(
  field: string,
  file: LocalFile,
  contract: FileContract | undefined,
): void {
  if (contract === undefined) return
  if (contract.maxBytes !== undefined && file.size > contract.maxBytes) {
    throw new AstraleError(
      'FILE_TOO_LARGE',
      `${file.path} is ${formatBytes(file.size)} (${file.size} bytes); ${field} accepts at most ${formatBytes(contract.maxBytes)} (${contract.maxBytes} bytes).`,
    )
  }
  if (contract.mediaTypes !== undefined && !mediaTypeAllowed(file.mediaType, contract.mediaTypes)) {
    throw new AstraleError(
      'FILE_MEDIA_TYPE_REFUSED',
      `${field} does not accept ${file.mediaType} (${file.path}).`,
      `It accepts ${contract.mediaTypes.join(', ')}. If the file is one of these, upload it with \`astrale upload ${file.path} --media-type <type>\` and pass the receipt as the field's value.`,
    )
  }
}

function mediaTypeAllowed(mediaType: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    let accepted: string
    try {
      accepted = acceptMediaType(entry)
    } catch {
      return false
    }
    if (accepted.endsWith('/*')) return mediaType.startsWith(accepted.slice(0, -1))
    return accepted === mediaType
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
