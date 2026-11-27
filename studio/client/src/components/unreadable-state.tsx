import { AlertTriangle } from 'lucide-react'

import type { UnreadableFile } from '@/lib/api'

import { Button } from '@/components/ui/button'

/**
 * Where a list would be when its Studio state file could not be read whole: why, and the file's
 * path, so it is fixed by hand. The Studio writes nothing over it meanwhile — every save is
 * refused — rather than drop the entries it could not read.
 */
export function UnreadableState({
  file,
  what,
  onRetry,
}: {
  file: UnreadableFile
  /** what the list holds, as a sentence's subject: "The Scenarios" */
  what: string
  onRetry?: () => void
}) {
  const reason = file.reason.charAt(0).toUpperCase() + file.reason.slice(1)
  return (
    <section
      role="alert"
      data-state-unreadable={file.path}
      className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-[13px] leading-relaxed"
    >
      <p className="flex items-center gap-1.5 font-medium text-warning">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {what} can't be read
      </p>
      <p>
        {reason}. The Studio leaves the file as it is and saves nothing to it until it is fixed.
      </p>
      <code className="block break-all rounded-md border bg-muted/40 p-2 font-mono text-[11px] text-foreground">
        {file.path}
      </code>
      {onRetry && (
        <Button variant="outline" size="xs" onClick={onRetry}>
          Read again
        </Button>
      )}
    </section>
  )
}
