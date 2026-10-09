/**
 * attachments.ts — images that ride a chat message.
 *
 * A pasted screenshot is part of what you are SAYING to the agent, not a
 * document of the domain: it goes with one message, is shown in that message,
 * and is handed to the agent as an image rather than as a path to go and read.
 */

import type { ChatAttachment } from './types'

/** The formats every harness Studio drives can look at. */
export type AttachmentImageType = ChatAttachment['mimeType']
export const ATTACHMENT_IMAGE_TYPES: readonly AttachmentImageType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]

/** The model APIs behind the harnesses refuse larger images outright. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

/** Enough for a before/after series; past that a message is a gallery. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10

export function isAttachmentImageType(value: unknown): value is AttachmentImageType {
  return ATTACHMENT_IMAGE_TYPES.includes(value as AttachmentImageType)
}

/** "1 image", "3 images" — what a message that is only images is called. */
export function imagesLabel(count: number): string {
  return `${count} image${count === 1 ? '' : 's'}`
}
