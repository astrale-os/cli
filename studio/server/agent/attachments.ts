/**
 * attachments.ts — the images a chat message carries, stored with the chat.
 *
 * An image is uploaded the moment it is pasted, so the send itself stays a small
 * JSON request and a queued message can name its images by id. The bytes live in
 * the studio's home under the chat they were pasted into — closing the chat
 * takes them with it, like the rest of its transcript.
 *
 * The type is read from the bytes, never from what the browser claimed: the file
 * is later served back from this origin and handed to the agent as an image, and
 * both have to be sure it is one.
 */
import { randomUUID } from 'node:crypto'

import type { ChatAttachment } from '../../shared/types'

import {
  type AttachmentImageType,
  isAttachmentImageType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '../../shared/attachments'
import { asFiniteNumber, asJsonRecord, asString } from '../json'
import {
  readJson,
  removeState,
  stateExists,
  statePath,
  writeJson,
  writeStateBuffer,
} from '../state/store'

const DIR = 'attachments'
const EXTENSIONS: Record<AttachmentImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}
/** ids are ours (`randomUUID`), so anything else in a URL is not one of them */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const chatDir = (chatId: string) => `${DIR}/${chatId}`
const metaFile = (chatId: string, id: string) => `${chatDir(chatId)}/${id}.json`
const dataFile = (chatId: string, attachment: ChatAttachment) =>
  `${chatDir(chatId)}/${attachment.id}.${EXTENSIONS[attachment.mimeType]}`

/** An image's own signature, or nothing when the bytes are not an image we take. */
export function sniffImageType(bytes: Uint8Array): AttachmentImageType | undefined {
  const starts = (offset: number, ...signature: number[]) =>
    signature.every((byte, index) => bytes[offset + index] === byte)
  if (starts(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0, 0x47, 0x49, 0x46, 0x38) && (starts(4, 0x37, 0x61) || starts(4, 0x39, 0x61)))
    return 'image/gif'
  if (starts(0, 0x52, 0x49, 0x46, 0x46) && starts(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return undefined
}

function decodeAttachment(value: unknown): ChatAttachment | undefined {
  const record = asJsonRecord(value)
  const id = asString(record?.id)
  const name = asString(record?.name)
  const size = asFiniteNumber(record?.size)
  if (
    !id ||
    !ID.test(id) ||
    !name ||
    size === undefined ||
    !isAttachmentImageType(record?.mimeType)
  )
    return undefined
  return { id, name, mimeType: record.mimeType, size }
}

/** Attachments as a stored run or queued message lists them — a bad entry is dropped. */
export function decodeAttachments(value: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const decoded = value.flatMap((entry) => {
    const attachment = decodeAttachment(entry)
    return attachment ? [attachment] : []
  })
  return decoded.length ? decoded : undefined
}

/** A name worth showing: the file's own, or one that says what it is and when. */
function attachmentName(given: string, mimeType: AttachmentImageType): string {
  const base = given.split(/[\\/]/).pop()?.trim().slice(0, 120)
  // the clipboard calls every screenshot `image.png`, which tells nobody anything
  if (base && base !== 'image.png') return base
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replaceAll(':', '.')
  return `Pasted image ${stamp}.${EXTENSIONS[mimeType]}`
}

export type SavedAttachment = { attachment: ChatAttachment } | { error: string }

/** Keep one image for `chatId`, or say why it is not one Studio can send. */
export function saveAttachment(
  root: string,
  chatId: string,
  input: { name: string; bytes: Uint8Array },
): SavedAttachment {
  if (input.bytes.byteLength === 0) return { error: `${input.name || 'the file'} is empty` }
  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES)
    return {
      error: `${input.name || 'the image'} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`,
    }
  const mimeType = sniffImageType(input.bytes)
  if (!mimeType)
    return { error: `${input.name || 'the file'} is not a PNG, JPEG, GIF or WebP image` }
  const attachment: ChatAttachment = {
    id: randomUUID(),
    name: attachmentName(input.name, mimeType),
    mimeType,
    size: input.bytes.byteLength,
  }
  writeStateBuffer(root, dataFile(chatId, attachment), input.bytes)
  writeJson(root, metaFile(chatId, attachment.id), attachment)
  return { attachment }
}

/** One stored image and where its bytes are, when it exists in this chat. */
export function readAttachment(
  root: string,
  chatId: string,
  id: string,
): { attachment: ChatAttachment; path: string } | undefined {
  if (!ID.test(id)) return undefined
  const attachment = readJson(root, metaFile(chatId, id), decodeAttachment, undefined)
  if (!attachment || attachment.id !== id || !stateExists(root, dataFile(chatId, attachment)))
    return undefined
  return { attachment, path: statePath(root, dataFile(chatId, attachment)) }
}

/**
 * The images a message names, in its order — or why it cannot be sent. An id
 * this chat does not hold is refused rather than skipped: the message would
 * otherwise leave without an image its author saw attached.
 */
export function resolveAttachments(
  root: string,
  chatId: string,
  ids: readonly string[],
): { attachments: ChatAttachment[] } | { error: string } {
  const unique = [...new Set(ids)]
  if (unique.length > MAX_ATTACHMENTS_PER_MESSAGE)
    return { error: `a message carries at most ${MAX_ATTACHMENTS_PER_MESSAGE} images` }
  const attachments: ChatAttachment[] = []
  for (const id of unique) {
    const found = readAttachment(root, chatId, id)
    if (!found) return { error: `unknown image: ${id}` }
    attachments.push(found.attachment)
  }
  return { attachments }
}

/** Where each image's bytes are, for the harness to read. Missing ones are skipped. */
export function attachmentFiles(
  root: string,
  chatId: string,
  attachments: readonly ChatAttachment[],
): { attachment: ChatAttachment; path: string }[] {
  return attachments.flatMap((attachment) => {
    const found = readAttachment(root, chatId, attachment.id)
    return found ? [found] : []
  })
}

/** Forget an image that was removed from the composer before it was ever sent. */
export function deleteAttachment(root: string, chatId: string, id: string): boolean {
  const found = readAttachment(root, chatId, id)
  if (!found) return false
  removeState(root, dataFile(chatId, found.attachment))
  removeState(root, metaFile(chatId, id))
  return true
}

/** Every image of a chat goes with the chat. */
export function deleteChatAttachments(root: string, chatId: string): void {
  try {
    removeState(root, chatDir(chatId))
  } catch {
    /* best-effort cleanup — the chat row is already gone */
  }
}
