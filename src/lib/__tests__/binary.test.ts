import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { readFile, unlink } from 'node:fs/promises'

import { presentBinary, type BinaryLike } from '../binary'

const png = (): BinaryLike => ({
  mediaType: 'image/png',
  body: new Uint8Array([1, 2, 3, 4]),
})

describe('presentBinary', () => {
  let chunks: Buffer[] = []
  let originalWrite: typeof process.stdout.write

  beforeEach(() => {
    chunks = []
    originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = mock((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
      return true
    }) as typeof process.stdout.write
  })

  afterEach(() => {
    process.stdout.write = originalWrite
  })

  test('--raw writes the raw bytes to stdout', async () => {
    await presentBinary(png(), { raw: true })
    expect(Array.from(Buffer.concat(chunks))).toEqual([1, 2, 3, 4])
  })

  test('--json writes a base64-wrapped JSON envelope', async () => {
    await presentBinary(png(), { json: true })
    const obj = JSON.parse(Buffer.concat(chunks).toString())
    expect(obj.contentType).toBe('image/png')
    expect([...Buffer.from(obj.bodyBase64, 'base64')]).toEqual([1, 2, 3, 4])
  })

  test('--json inlines text for text-like content types', async () => {
    await presentBinary(
      { mediaType: 'text/plain', body: new TextEncoder().encode('hi') },
      { json: true },
    )
    const obj = JSON.parse(Buffer.concat(chunks).toString())
    expect(obj.body).toBe('hi')
  })

  test('-o writes raw bytes to a file', async () => {
    const tmp = `${process.env.TMPDIR ?? '/tmp'}/astrale-bin-test-${process.pid}.bin`
    await presentBinary(png(), {}, { outFile: tmp })
    expect([...(await readFile(tmp))]).toEqual([1, 2, 3, 4])
    await unlink(tmp)
  })
})
