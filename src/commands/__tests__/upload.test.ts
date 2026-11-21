import { beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConnectionContext } from '../../connection'

import { uploadCommand } from '../upload'
import { captureProcess, ExitError } from './fixtures/process'

const io = captureProcess()

const CSV = 'account,debit\n401,12\n'
const digestOf = (bytes: string | Uint8Array) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

interface Sent {
  readonly bytes: string
  readonly mediaType: string
  readonly isBlob: boolean
}

let sent: Sent[]
let credential: unknown
let connections: number
let runError: unknown

const session = {
  content: {
    async upload(body: Blob, options: { mediaType: string }) {
      const bytes = await body.text()
      sent.push({ bytes, mediaType: options.mediaType, isBlob: body instanceof Blob })
      return {
        receipt: 'receipt-1',
        ref: { digest: digestOf(bytes), mediaType: options.mediaType, size: body.size },
        expiresAt: '2026-11-02T12:15:00.000Z',
      }
    },
  },
}

const adapters = {
  async runKernelCommand(input: {
    opts: Record<string, unknown>
    credential?: unknown
    fn: (context: ConnectionContext) => Promise<unknown>
    format?: (result: never, opts: never, machine: boolean) => unknown
  }) {
    connections += 1
    credential = input.credential
    try {
      const result = await input.fn({ session } as unknown as ConnectionContext)
      await input.format?.(result as never, input.opts as never, true)
    } catch (error) {
      runError = error
    }
  },
} as unknown as Parameters<typeof uploadCommand>[2]

beforeEach(() => {
  sent = []
  credential = undefined
  connections = 0
  runError = undefined
})

const directory = () => mkdtempSync(join(tmpdir(), 'astrale-upload-'))

function fileWith(name: string, content: string): string {
  const path = join(directory(), name)
  writeFileSync(path, content)
  return path
}

describe('upload command', () => {
  test('streams the file as the caller and describes its receipt', async () => {
    const path = fileWith('balance.csv', CSV)

    await uploadCommand(path, { json: true }, adapters)

    expect(runError).toBeUndefined()
    expect(credential).toEqual({ principal: 'caller' })
    expect(sent).toEqual([{ bytes: CSV, mediaType: 'text/csv', isBlob: true }])
    expect(JSON.parse(io.stdout)).toEqual({
      receipt: 'receipt-1',
      digest: digestOf(CSV),
      mediaType: 'text/csv',
      size: CSV.length,
      expiresAt: '2026-11-02T12:15:00.000Z',
      file: path,
    })
  })

  test('prints the receipt alone with --raw', async () => {
    await uploadCommand(fileWith('a.bin', 'xyz'), { raw: true }, adapters)

    expect(io.stdout).toBe('receipt-1\n')
    expect(sent[0]!.mediaType).toBe('application/octet-stream')
  })

  test('declares an explicit media type, canonicalized', async () => {
    await uploadCommand(
      fileWith('scan.bin', 'png'),
      { json: true, mediaType: 'Image/PNG' },
      adapters,
    )

    expect(sent[0]!.mediaType).toBe('image/png')
  })

  test('refuses a missing file before connecting', async () => {
    const path = join(directory(), 'missing.csv')

    await expect(uploadCommand(path, { json: true }, adapters)).rejects.toThrow(ExitError)

    expect(io.failure()).toMatchObject({
      error: 'FILE_MISSING',
      message: `${path} does not exist.`,
    })
    expect(connections).toBe(0)
  })

  test('refuses a directory', async () => {
    await expect(uploadCommand(directory(), { json: true }, adapters)).rejects.toThrow(ExitError)

    expect(io.failure()).toMatchObject({ error: 'FILE_UNREADABLE' })
    expect(connections).toBe(0)
  })

  test('refuses a file over the Kernel bound of 100 MiB without reading it', async () => {
    const path = join(directory(), 'big.bin')
    writeFileSync(path, '')
    truncateSync(path, 100 * 1024 * 1024 + 1)

    await expect(uploadCommand(path, { json: true }, adapters)).rejects.toThrow(ExitError)

    expect(io.failure()).toMatchObject({
      error: 'FILE_TOO_LARGE',
      message: `${path} is 100.0 MiB (104857601 bytes); the Kernel accepts at most 100 MiB (104857600 bytes) per file.`,
    })
    expect(connections).toBe(0)
  })

  test('refuses an invalid media type', async () => {
    await expect(
      uploadCommand(fileWith('a.csv', CSV), { json: true, mediaType: 'csv' }, adapters),
    ).rejects.toThrow(ExitError)

    expect(io.failure()).toMatchObject({ error: 'MEDIA_TYPE_INVALID' })
    expect(connections).toBe(0)
  })
})
