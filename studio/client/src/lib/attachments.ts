/**
 * attachments.ts — the images waiting in the composer, per chat.
 *
 * An image is uploaded the moment it is pasted or dropped, so Send only has to
 * name it — and a large screenshot is already on the server by the time you
 * finish typing about it. Until then its chip shows the local copy, spinning.
 *
 * Like the draft text, the images belong to the chat they were added to:
 * switching tabs shows that tab's own, and a send that fails puts them back.
 */
import type { ChatAttachment } from '@shared/types'

import {
  isAttachmentImageType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '@shared/attachments'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'

import { api } from './api'

export interface DraftImage {
  /** this chip's own key — the server id only exists once the upload lands */
  key: string
  name: string
  /** what the chip shows: the local copy while uploading, the stored one after */
  src: string
  status: 'uploading' | 'ready'
  attachment?: ChatAttachment
}

interface DraftImagesState {
  images: Record<string, DraftImage[]>
  add: (chatId: string, image: DraftImage) => void
  update: (chatId: string, key: string, patch: Partial<DraftImage>) => void
  drop: (chatId: string, key: string) => DraftImage | undefined
  /** hand every image over to a send, leaving the composer empty */
  take: (chatId: string) => DraftImage[]
  /** a send that failed gives its images back, in front of any added since */
  restore: (chatId: string, attachments: ChatAttachment[]) => void
}

const NONE: DraftImage[] = []

/** Object URLs are only ours to free when we made them. */
function release(image: DraftImage): void {
  if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src)
}

export const useDraftImages = create<DraftImagesState>((set, get) => ({
  images: {},
  add: (chatId, image) =>
    set((s) => ({ images: { ...s.images, [chatId]: [...(s.images[chatId] ?? NONE), image] } })),
  update: (chatId, key, patch) =>
    set((s) => ({
      images: {
        ...s.images,
        [chatId]: (s.images[chatId] ?? NONE).map((image) => {
          if (image.key !== key) return image
          if (patch.src && patch.src !== image.src) release(image)
          return { ...image, ...patch }
        }),
      },
    })),
  drop: (chatId, key) => {
    const image = get().images[chatId]?.find((entry) => entry.key === key)
    if (!image) return undefined
    release(image)
    set((s) => ({
      images: { ...s.images, [chatId]: (s.images[chatId] ?? NONE).filter((e) => e.key !== key) },
    }))
    return image
  },
  take: (chatId) => {
    const taken = get().images[chatId] ?? NONE
    taken.forEach(release)
    set((s) => ({ images: { ...s.images, [chatId]: NONE } }))
    return taken
  },
  restore: (chatId, attachments) =>
    set((s) => ({
      images: {
        ...s.images,
        [chatId]: [
          ...attachments.map((attachment): DraftImage => ({
            key: attachment.id,
            name: attachment.name,
            src: api.attachmentUrl(chatId, attachment.id),
            status: 'ready',
            attachment,
          })),
          ...(s.images[chatId] ?? NONE).filter(
            (image) => !attachments.some((entry) => entry.id === image.attachment?.id),
          ),
        ],
      },
    })),
}))

/** The longest edge a re-encoded image keeps — what the model APIs scale down to anyway. */
const MAX_EDGE = 2048

/** The size that fits `width`×`height` inside `MAX_EDGE`, keeping its shape. */
export function fitWithin(width: number, height: number, edge = MAX_EDGE) {
  const scale = Math.min(1, edge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * The bytes to upload for one picked file: as they are when the agent can take
 * them, re-encoded when they are too large or in a format it cannot read (a
 * HEIC photo, a BMP, an SVG). Screenshots stay PNG so their text stays sharp;
 * only what is still too big after that becomes a JPEG.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (isAttachmentImageType(file.type) && file.size <= MAX_ATTACHMENT_BYTES) return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`${file.name || 'this file'} is not an image the agent can read`)
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const encode = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  const png = await encode('image/png')
  if (png && png.size <= MAX_ATTACHMENT_BYTES) return png
  const jpeg = await encode('image/jpeg', 0.85)
  if (jpeg && jpeg.size <= MAX_ATTACHMENT_BYTES) return jpeg
  throw new Error(`${file.name || 'this image'} is too large to send, even scaled down`)
}

/** The file name the upload goes by, with the extension of what is actually sent. */
function uploadName(file: File, blob: Blob): string {
  if (blob === file) return file.name
  const base = file.name.replace(/\.[^.]+$/, '') || 'image'
  return `${base}.${blob.type === 'image/jpeg' ? 'jpg' : 'png'}`
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

/** One chat's composer images, and the ways to add and take them back. */
export function useComposerImages(chatId: string | undefined) {
  const images = useDraftImages((s) => (chatId ? (s.images[chatId] ?? NONE) : NONE))

  const attach = useCallback(
    (files: File[]) => {
      if (!chatId) {
        toast.info('The conversation is still loading — try again in a moment.')
        return
      }
      const store = useDraftImages.getState()
      const room = MAX_ATTACHMENTS_PER_MESSAGE - (store.images[chatId]?.length ?? 0)
      if (files.length > room)
        toast.info(`A message carries at most ${MAX_ATTACHMENTS_PER_MESSAGE} images.`)
      for (const file of files.slice(0, Math.max(0, room))) {
        const key = crypto.randomUUID()
        const present = () =>
          useDraftImages.getState().images[chatId]?.some((image) => image.key === key) ?? false
        // the chip goes up at once, holding its place in the count and the order
        store.add(chatId, {
          key,
          name: file.name,
          src: URL.createObjectURL(file),
          status: 'uploading',
        })
        void prepareImage(file)
          .then(async (blob) => {
            if (!present()) return
            if (blob !== file) store.update(chatId, key, { src: URL.createObjectURL(blob) })
            const attachment = await api.uploadAttachment(chatId, blob, uploadName(file, blob))
            // removed while it was on the wire: the server copy goes too
            if (!present()) {
              void api.deleteAttachment(chatId, attachment.id).catch(() => undefined)
              return
            }
            store.update(chatId, key, { status: 'ready', attachment, name: attachment.name })
          })
          .catch((error: unknown) => {
            store.drop(chatId, key)
            toast.error(
              `Could not attach the image — ${error instanceof Error ? error.message : String(error)}`,
            )
          })
      }
    },
    [chatId],
  )

  const detach = useCallback(
    (key: string) => {
      if (!chatId) return
      const image = useDraftImages.getState().drop(chatId, key)
      // never sent: nothing will ever show it again, so the server copy goes
      if (image?.attachment)
        void api.deleteAttachment(chatId, image.attachment.id).catch(() => undefined)
    },
    [chatId],
  )

  return {
    images,
    attach,
    detach,
    uploading: images.some((image) => image.status === 'uploading'),
  }
}
