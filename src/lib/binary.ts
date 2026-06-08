import chalk from 'chalk'
import { writeFile } from 'node:fs/promises'

import type { OutputOpts } from './output'

import { output } from './output'

/** A binary kernel result: bytes (or a stream of them) plus its content-type. */
export type BinaryLike = {
  status: number
  contentType: string
  body: Uint8Array | ReadableStream<Uint8Array>
}

/** Collapse a (possibly streamed) binary body into a single byte array. */
export async function readBinaryBody(
  body: Uint8Array | ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body

  const chunks: Uint8Array[] = []
  const reader = body.getReader()
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    total += value.byteLength
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
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
  if (isTextLike(resp.contentType)) {
    return {
      status: resp.status,
      contentType: resp.contentType,
      body: new TextDecoder().decode(bytes),
    }
  }
  return {
    status: resp.status,
    contentType: resp.contentType,
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
      chalk.dim(`  wrote ${humanSize(bytes.length)} (${resp.contentType}) → ${io.outFile}\n`),
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

  if (isTextLike(resp.contentType)) {
    const text = new TextDecoder().decode(bytes)
    process.stdout.write(text.endsWith('\n') ? text : text + '\n')
    return
  }

  process.stdout.write(
    chalk.dim(
      `  <binary · ${resp.contentType} · ${humanSize(bytes.length)}> — pipe or use -o <file> to save\n`,
    ),
  )
}
