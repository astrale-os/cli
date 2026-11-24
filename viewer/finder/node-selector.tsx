import type { FinderChoice } from '@astrale-os/ui/finder'

import { cn } from '@astrale-os/ui/class-name'
import { Dialog, DialogContent } from '@astrale-os/ui/dialog'
import { useId } from 'react'

import { NodeBrowser, type NodeBrowserProps } from './node-browser.js'

export interface NodeSelectorProps extends Omit<
  NodeBrowserProps,
  'titleId' | 'descriptionId' | 'onConfirm' | 'onCancel'
> {
  /** The dialog shows while a request is open. */
  open: boolean
  onConfirm(choices: readonly FinderChoice[]): void | Promise<void>
  /** Cancel, Escape, or a click outside. */
  onCancel(): void
  className?: string
  style?: React.CSSProperties
}

/** The Finder in a dialog: what a host shows when a View asks the user to select Nodes. */
export function NodeSelector({
  open,
  onConfirm,
  onCancel,
  className,
  style,
  ...browser
}: NodeSelectorProps) {
  const titleId = useId()
  const descriptionId = useId()
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        // The Finder owns Escape: it closes the preview, then the filter bar, then cancels.
        if (!next && details.reason !== 'escape-key') onCancel()
      }}
    >
      <DialogContent
        data-slot="block-finder-node-selector"
        aria-labelledby={titleId}
        aria-describedby={browser.description ? descriptionId : undefined}
        showCloseButton={false}
        className={cn(
          'h-[min(40rem,calc(100dvh-2rem))] grid-cols-1 gap-0 overflow-hidden p-0 sm:max-w-[min(72rem,calc(100%-2rem))]',
          className,
        )}
        style={style}
      >
        <NodeBrowser
          {...browser}
          titleId={titleId}
          descriptionId={descriptionId}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </DialogContent>
    </Dialog>
  )
}
