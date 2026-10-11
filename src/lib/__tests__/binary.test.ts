import { expect, spyOn, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { presentBinary, type BinaryLike } from '../terminal/binary'

const png = (): BinaryLike => ({ mediaType: 'image/png', body: new Uint8Array([1, 2, 3, 4]) })

/** The bytes `present` wrote to stdout. */
async function written(present: () => Promise<void>): Promise<Buffer> {
  const chunks: Buffer[] = []
  const write = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(Buffer.from(chunk as Uint8Array))
    return true
  })
  try {
    await present()
    return Buffer.concat(chunks)
  } finally {
    write.mockRestore()
  }
}

test('--raw writes the exact bytes, streamed chunks in order, and -o writes them to a file', async () => {
  expect([...(await written(() => presentBinary(png(), { raw: true })))]).toEqual([1, 2, 3, 4])
  const streamed = {
    mediaType: 'application/octet-stream',
    body: (async function* () {
      yield new Uint8Array([1, 2])
      yield new Uint8Array([3, 4])
    })(),
  }
  expect([...(await written(() => presentBinary(streamed, { raw: true })))]).toEqual([1, 2, 3, 4])
  const file = join(await mkdtemp(join(tmpdir(), 'astrale-binary-')), 'out.bin')
  await presentBinary(png(), {}, { outFile: file })
  expect([...(await readFile(file))]).toEqual([1, 2, 3, 4])
})

test('--json wraps bytes as base64, and inlines text-like content', async () => {
  const wrapped = JSON.parse(String(await written(() => presentBinary(png(), { json: true }))))
  expect(wrapped.contentType).toBe('image/png')
  expect([...Buffer.from(wrapped.bodyBase64, 'base64')]).toEqual([1, 2, 3, 4])
  const text = { mediaType: 'text/plain', status: 202, body: new TextEncoder().encode('hi') }
  expect(
    JSON.parse(String(await written(() => presentBinary(text, { json: true })))),
  ).toMatchObject({ body: 'hi', status: 202 })
})
