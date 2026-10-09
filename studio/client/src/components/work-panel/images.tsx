/**
 * images.tsx — the images a message carries, where you write it and where you
 * read it back.
 *
 * In the composer they are chips above the field: small, removable, spinning
 * until the upload lands. In the conversation they sit with the message they
 * were sent with, at a size you can recognise — and either one opens full size.
 */
import type { ChatAttachment } from '@shared/types'

import { Loader2, X } from 'lucide-react'
import { useState } from 'react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { type DraftImage } from '@/lib/attachments'
import { cn } from '@/lib/utils'

/** What the full-size preview needs: a draft image or a sent one. */
interface PreviewImage {
  name: string
  src: string
}

/** One image at full size, over everything. */
function ImagePreview({ image, onClose }: { image: PreviewImage | null; onClose: () => void }) {
  return (
    <Dialog open={!!image} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-auto max-w-[min(92vw,1400px)] gap-2 p-3">
        <DialogTitle className="truncate pr-8 text-[13px] font-medium">{image?.name}</DialogTitle>
        {image && (
          <img
            src={image.src}
            alt={image.name}
            className="max-h-[80vh] max-w-full rounded-md object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The images waiting in the composer, each one removable until it is sent. */
export function ComposerImages({
  images,
  onRemove,
}: {
  images: DraftImage[]
  onRemove: (key: string) => void
}) {
  const [open, setOpen] = useState<DraftImage | null>(null)
  if (!images.length) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-2 pt-2" data-composer-images="">
      {images.map((image) => (
        <div key={image.key} className="group relative h-14 w-14 shrink-0">
          <button
            type="button"
            onClick={() => setOpen(image)}
            title={image.name}
            aria-label={`Preview ${image.name}`}
            className="h-full w-full overflow-hidden rounded-lg border bg-muted"
          >
            <img
              src={image.src}
              alt={image.name}
              className={cn(
                'h-full w-full object-cover',
                image.status === 'uploading' && 'opacity-50',
              )}
            />
          </button>
          {image.status === 'uploading' && (
            <span
              role="status"
              aria-label={`Uploading ${image.name}`}
              className="pointer-events-none absolute inset-0 grid place-items-center"
            >
              <Loader2 className="h-4 w-4 animate-spin text-foreground" />
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(image.key)}
            title="Remove this image"
            aria-label={`Remove ${image.name}`}
            className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}
      <ImagePreview image={open} onClose={() => setOpen(null)} />
    </div>
  )
}

/** The images of a sent message, right-aligned above its text like the bubble. */
export function MessageImages({
  chatId,
  attachments,
}: {
  chatId: string
  attachments: ChatAttachment[]
}) {
  const [open, setOpen] = useState<PreviewImage | null>(null)
  const single = attachments.length === 1

  return (
    <div className="flex flex-wrap justify-end gap-1.5" data-message-images="">
      {attachments.map((attachment) => {
        const src = api.attachmentUrl(chatId, attachment.id)
        return (
          <button
            key={attachment.id}
            type="button"
            onClick={() => setOpen({ name: attachment.name, src })}
            title={attachment.name}
            aria-label={`Open ${attachment.name}`}
            className={cn(
              'overflow-hidden rounded-xl border bg-muted',
              single ? 'max-w-[85%]' : 'h-24 w-24',
            )}
          >
            <img
              src={src}
              alt={attachment.name}
              loading="lazy"
              className={single ? 'max-h-60 w-auto object-contain' : 'h-full w-full object-cover'}
            />
          </button>
        )
      })}
      <ImagePreview image={open} onClose={() => setOpen(null)} />
    </div>
  )
}
