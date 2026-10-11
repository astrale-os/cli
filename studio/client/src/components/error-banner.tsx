import { AlertTriangle, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * A schema diagnostic is one unbounded sentence per offending declaration, so the banner
 * stays exactly ONE line tall whatever it carries — it must never push the canvas down:
 * the leading message truncates, the rest hide behind a count, and the modal is where the
 * text is read whole. Copying it out is the usual next move, so the copy sits one click
 * deep in the strip and at the top right of the modal.
 */
export function ErrorBanner({
  messages,
  title = 'Schema diagnostics',
}: {
  /** One entry per diagnostic; blank entries are dropped and an empty banner renders nothing. */
  messages: readonly string[]
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const items = messages.filter((message) => message.trim().length > 0)
  if (items.length === 0) return null
  const copyLabel = items.length > 1 ? 'Copy every message' : 'Copy the message'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(items.join('\n\n'))
      toast.success(items.length > 1 ? 'Messages copied' : 'Message copied')
    } catch {
      toast.error('Copy failed — select the text and copy it manually')
    }
  }

  return (
    <>
      <div
        className="flex h-9 shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 text-sm text-warning"
        data-testid="error-banner"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Read the full message"
          className="min-w-0 flex-1 cursor-pointer truncate text-left underline-offset-2 hover:underline"
        >
          {items[0]}
        </button>
        {items.length > 1 && (
          <span className="shrink-0 rounded-full border border-warning/40 px-1.5 text-[11px] leading-5">
            +{items.length - 1}
          </span>
        )}
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void copy()}
          title={copyLabel}
          aria-label={copyLabel}
          className="shrink-0 px-1.5 text-warning hover:bg-warning/15 hover:text-warning"
        >
          <Copy />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setOpen(true)}
          className="shrink-0 text-warning hover:bg-warning/15 hover:text-warning"
        >
          Details
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl" data-testid="error-banner-modal">
          <DialogHeader className="flex-row items-center justify-between gap-3 pr-9">
            <DialogTitle className="flex min-w-0 items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              {title}
              {items.length > 1 && (
                <span className="text-xs font-normal text-muted-foreground">
                  {items.length} messages
                </span>
              )}
            </DialogTitle>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => void copy()}>
              <Copy /> Copy
            </Button>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto">
            {items.map((message, index) => (
              <p
                key={index}
                className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2.5 font-mono text-xs leading-relaxed text-foreground"
              >
                {message}
              </p>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
