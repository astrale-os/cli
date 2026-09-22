import { AlertTriangle, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * A schema diagnostic is one unbounded sentence per offending declaration, so a compiler
 * that disagrees with four classes at once used to push the canvas several lines down
 * before anyone could read the first word. The banner therefore stays exactly ONE line
 * tall whatever it carries: the leading message truncates, the rest hide behind a count,
 * and the modal is the place where the text is read whole and copied out — into an agent
 * turn, an issue, a search — instead of being selected out of a wrapping strip.
 */
export function ErrorBanner({
  messages,
  title = 'Schema diagnostics',
  className,
}: {
  /** One entry per diagnostic; blank entries are dropped and an empty banner renders nothing. */
  messages: readonly string[]
  title?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const items = messages.filter((message) => message.trim().length > 0)
  if (items.length === 0) return null

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
        className={cn(
          'flex h-9 shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 text-sm text-warning',
          className,
        )}
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
          onClick={() => setOpen(true)}
          className="shrink-0 text-warning hover:bg-warning/15 hover:text-warning"
        >
          Details
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" data-testid="error-banner-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              {title}
              {items.length > 1 && (
                <span className="text-xs font-normal text-muted-foreground">
                  {items.length} messages
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {items.map((message, index) => (
              <p
                key={index}
                className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2.5 font-mono text-xs leading-relaxed text-foreground"
              >
                {message}
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              <Copy /> Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
