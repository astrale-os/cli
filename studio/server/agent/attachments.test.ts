import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MAX_ATTACHMENT_BYTES } from '../../shared/attachments'
import {
  deleteAttachment,
  deleteChatAttachments,
  readAttachment,
  resolveAttachments,
  saveAttachment,
  sniffImageType,
} from './attachments'

const roots: string[] = []
const root = () => {
  const value = mkdtempSync(join(tmpdir(), 'studio-attachments-'))
  roots.push(value)
  return value
}
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

const bytes = (...values: number[]) => Uint8Array.from(values)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)
const saved = (result: ReturnType<typeof saveAttachment>) => {
  if ('error' in result) throw new Error(result.error)
  return result.attachment
}

test('the type comes from the bytes, whatever the name claims', () => {
  expect(sniffImageType(PNG)).toBe('image/png')
  expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
  expect(sniffImageType(new TextEncoder().encode('GIF89a...'))).toBe('image/gif')
  expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
  // an SVG is text that runs script when served; it is never an image here
  expect(
    sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
  ).toBe(undefined)
})

test('keeps an image with its chat and gives a pasted one a name', () => {
  const dir = root()
  const named = saved(saveAttachment(dir, 'chat-a', { name: 'mockup.png', bytes: PNG }))
  const pasted = saved(saveAttachment(dir, 'chat-a', { name: 'image.png', bytes: PNG }))
  expect(named).toMatchObject({ name: 'mockup.png', mimeType: 'image/png', size: PNG.length })
  expect(pasted.name).toMatch(/^Pasted image .+\.png$/)
  expect(readAttachment(dir, 'chat-a', named.id)?.attachment).toEqual(named)
  // another chat's images are not this one's to send
  expect(readAttachment(dir, 'chat-b', named.id)).toBeUndefined()
  expect(resolveAttachments(dir, 'chat-a', [pasted.id, named.id, pasted.id])).toEqual({
    attachments: [pasted, named],
  })
  expect(resolveAttachments(dir, 'chat-b', [named.id])).toMatchObject({
    error: expect.stringContaining('unknown image'),
  })
})

test('refuses what the agent could not take', () => {
  const dir = root()
  expect(saveAttachment(dir, 'chat', { name: 'empty.png', bytes: new Uint8Array() })).toMatchObject(
    { error: expect.stringContaining('empty') },
  )
  const huge = new Uint8Array(MAX_ATTACHMENT_BYTES + 1)
  huge.set(PNG)
  expect(saveAttachment(dir, 'chat', { name: 'huge.png', bytes: huge })).toMatchObject({
    error: expect.stringContaining('larger than 5 MB'),
  })
  // a path in a URL is not an id
  expect(readAttachment(dir, 'chat', '../../chats/secret')).toBeUndefined()
})

test('an image goes when removed, and all of them go with their chat', () => {
  const dir = root()
  const first = saved(saveAttachment(dir, 'chat', { name: 'a.png', bytes: PNG }))
  const second = saved(saveAttachment(dir, 'chat', { name: 'b.png', bytes: PNG }))
  expect(deleteAttachment(dir, 'chat', first.id)).toBe(true)
  expect(deleteAttachment(dir, 'chat', first.id)).toBe(false)
  expect(readAttachment(dir, 'chat', second.id)).toBeDefined()
  deleteChatAttachments(dir, 'chat')
  expect(readAttachment(dir, 'chat', second.id)).toBeUndefined()
})
