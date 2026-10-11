import chalk from 'chalk'
import { writeFile } from 'node:fs/promises'

import type { OutputOpts } from './output'

import { output } from './output'

/** A binary kernel result: bytes (or a stream of them) plus its content-type. */
export type BinaryLike = {
  readonly body: Uint8Array | AsyncIterable<Uint8Array>
  readonly mediaType: string
  readonly status?: number
  readonly headers?: Readonly<Record<string, string>>
}

/** Collapse a (possibly streamed) binary body into a single byte array. */
export async function readBinaryBody(
  body: Uint8Array | AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return new Uint8Array(body)
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of body) {
    const detached = new Uint8Array(chunk)
    chunks.push(detached)
    size += detached.byteLength
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function isTextLike(contentType: string): boolean {
  const ct = contentType.toLowerCase()
  return (
    ct.startsWith('text/') ||
    ct.includes('json') ||
    ct.includes('xml') ||
    ct.includes('event-stream')
  )
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['kB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

/** The `--json` envelope: text-like inlines decoded text, otherwise base64. */
function jsonEnvelope(resp: BinaryLike, bytes: Uint8Array): Record<string, unknown> {
  if (isTextLike(resp.mediaType)) {
    return {
      status: resp.status ?? 200,
      contentType: resp.mediaType,
      body: new TextDecoder().decode(bytes),
    }
  }
  return {
    status: resp.status ?? 200,
    contentType: resp.mediaType,
    bodyBase64: Buffer.from(bytes).toString('base64'),
  }
}

/**
 * Present a binary kind result.
 *
 * Precedence:
 *   -o <file>       → write raw bytes to a file (+ a dim summary on stderr)
 *   --raw           → raw bytes to stdout
 *   --json          → base64/text-wrapped JSON object (jq-friendly)
 *   non-TTY (pipe)  → raw bytes to stdout (`astrale call … > out.png`)
 *   TTY, text-like  → decode and print the text
 *   TTY, otherwise  → a one-line summary (don't spew binary at a terminal)
 */
export async function presentBinary(
  resp: BinaryLike,
  opts: OutputOpts,
  io?: { outFile?: string },
): Promise<void> {
  const bytes = await readBinaryBody(resp.body)

  if (io?.outFile) {
    await writeFile(io.outFile, bytes)
    process.stderr.write(
      chalk.dim(`  wrote ${humanSize(bytes.length)} (${resp.mediaType}) → ${io.outFile}\n`),
    )
    return
  }

  if (opts.raw) {
    process.stdout.write(bytes)
    return
  }

  if (opts.json) {
    output(jsonEnvelope(resp, bytes), opts)
    return
  }

  if (!(process.stdout.isTTY ?? false)) {
    process.stdout.write(bytes)
    return
  }

  if (isTextLike(resp.mediaType)) {
    const text = new TextDecoder().decode(bytes)
    process.stdout.write(text.endsWith('\n') ? text : text + '\n')
    return
  }

  process.stdout.write(
    chalk.dim(
      `  <binary · ${resp.mediaType} · ${humanSize(bytes.length)}> — pipe or use -o <file> to save\n`,
    ),
  )
}
