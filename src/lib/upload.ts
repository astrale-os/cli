import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'

import type { ConnectionContext } from '../connection'

import { AstraleError } from '../errors'

/** The Kernel's upload bound (`MAXIMUM_BLOB_BYTES`): 100 MiB. A blob property may set a lower one. */
export const MAXIMUM_UPLOAD_BYTES = 100 * 1_024 * 1_024

/** A file on disk admitted for upload: it exists, is a regular file and fits the Kernel bound. */
export interface LocalFile {
  /** The path as the user wrote it. */
  readonly path: string
  readonly size: number
  readonly mediaType: string
}

/** What `upload` answers: the receipt a blob property or a file input accepts, and its file. */
export interface Uploaded {
  readonly receipt: string
  readonly digest: string
  readonly mediaType: string
  readonly size: number
  readonly expiresAt: string
  /** The local file uploaded. */
  readonly file: string
}

/** Read `path` before any connection: refuse a missing, unreadable or oversized file. */
export async function localFile(path: string, mediaType?: string): Promise<LocalFile> {
  if (path === '') throw new AstraleError('FILE_REQUIRED', 'No file path was given.')
  let stats
  try {
    stats = await stat(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new AstraleError(
      code === 'ENOENT' ? 'FILE_MISSING' : 'FILE_UNREADABLE',
      code === 'ENOENT' ? `${path} does not exist.` : `Cannot read ${path} (${code ?? 'error'}).`,
      code === 'ENOENT' ? 'Check the path, relative to the current directory.' : undefined,
    )
  }
  if (!stats.isFile()) {
    throw new AstraleError('FILE_UNREADABLE', `${path} is not a regular file.`)
  }
  if (stats.size > MAXIMUM_UPLOAD_BYTES) {
    throw new AstraleError(
      'FILE_TOO_LARGE',
      `${path} is ${formatBytes(stats.size)} (${stats.size} bytes); the Kernel accepts at most ${formatBytes(MAXIMUM_UPLOAD_BYTES)} (${MAXIMUM_UPLOAD_BYTES} bytes) per file.`,
      'Split the file or compress it before uploading.',
    )
  }
  return Object.freeze({
    path,
    size: stats.size,
    mediaType: mediaType === undefined ? inferMediaType(path) : acceptMediaType(mediaType),
  })
}

/**
 * Stream one file to the Kernel and return its receipt. The file is opened as a Blob backed by the
 * disk, never read into memory, and a retried request reads it again from the start.
 */
export async function uploadFile(
  session: Pick<ConnectionContext['session'], 'content'>,
  file: LocalFile,
): Promise<Uploaded> {
  let body: Blob
  try {
    body = await openAsBlob(file.path)
  } catch (error) {
    throw new AstraleError(
      'FILE_UNREADABLE',
      `Cannot read ${file.path} (${(error as NodeJS.ErrnoException).code ?? 'error'}).`,
    )
  }
  if (body.size !== file.size) {
    throw new AstraleError(
      'FILE_CHANGED',
      `${file.path} changed while it was being uploaded.`,
      'Upload it again once it is no longer being written.',
    )
  }
  const uploaded = await session.content.upload(body, { mediaType: file.mediaType })
  return Object.freeze({
    receipt: uploaded.receipt,
    digest: uploaded.ref.digest,
    mediaType: uploaded.ref.mediaType,
    size: uploaded.ref.size,
    expiresAt: uploaded.expiresAt,
    file: file.path,
  })
}

/** Media types by lowercase extension; anything else is `application/octet-stream`. */
const MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.eml': 'message/rfc822',
  '.epub': 'application/epub+zip',
  '.gif': 'image/gif',
  '.gz': 'application/gzip',
  '.heic': 'image/heic',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.ics': 'text/calendar',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.m4a': 'audio/mp4',
  '.md': 'text/markdown',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ogg': 'audio/ogg',
  '.parquet': 'application/vnd.apache.parquet',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.svg': 'image/svg+xml',
  '.tar': 'application/x-tar',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.tsv': 'text/tab-separated-values',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.zip': 'application/zip',
})

/**
 * The media type a file's extension names, without parameters: a blob property that lists
 * `text/csv` refuses `text/csv;charset=utf-8`. Pass `--media-type` for anything else.
 */
export function inferMediaType(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u

/** A `type/subtype[;name=value]...` media type, essence and parameter names lowercased. */
export function acceptMediaType(input: string): string {
  const [essence = '', ...parameters] = input.split(';')
  const [type, subtype, ...extra] = essence.trim().split('/')
  if (
    type === undefined ||
    subtype === undefined ||
    extra.length > 0 ||
    !TOKEN.test(type) ||
    !TOKEN.test(subtype)
  ) {
    throw new AstraleError(
      'MEDIA_TYPE_INVALID',
      `"${input}" is not a media type.`,
      'Write it as type/subtype, for example text/csv or application/pdf.',
    )
  }
  const accepted = parameters.map((parameter) => {
    const separator = parameter.indexOf('=')
    const name = parameter.slice(0, separator).trim().toLowerCase()
    const value = parameter.slice(separator + 1).trim()
    if (separator <= 0 || !TOKEN.test(name) || !TOKEN.test(value)) {
      throw new AstraleError('MEDIA_TYPE_INVALID', `"${input}" has an invalid parameter.`)
    }
    return `;${name}=${value}`
  })
  return `${type.toLowerCase()}/${subtype.toLowerCase()}${accepted.join('')}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes / 1_024
  let unit = 0
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024
    unit++
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`
}

/** The Kernel refuses a receipt it did not issue to this caller, or that expired. */
export const RECEIPT_REFUSED_HINT =
  'An upload receipt works only for the identity that uploaded the file, and only until it expires (its expiresAt; Kernels are moving to 15 minutes). Upload the file again (`astrale upload`, or `astrale call --file`) and use the new receipt.'

/** Whether a Kernel failure reason names a refused upload receipt, at any depth. */
export function receiptRefused(reason: unknown, depth = 0): boolean {
  if (depth > 4 || reason === null || typeof reason !== 'object') return false
  if (Array.isArray(reason)) return reason.some((item) => receiptRefused(item, depth + 1))
  return Object.entries(reason).some(([key, value]) =>
    typeof value === 'string'
      ? key === 'code' && RECEIPT_CODES.has(value)
      : receiptRefused(value, depth + 1),
  )
}

const RECEIPT_CODES: ReadonlySet<string> = new Set([
  'MUTATION_BLOB_RECEIPT_INVALID',
  'BLOB_RECEIPT_INVALID',
  'BLOB_RECEIPT_EXPIRED',
])
