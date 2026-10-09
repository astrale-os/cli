import { Copy, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useStudioRuntime } from '@/lib/hooks'

/** This signal survives an empty domain catalog: the old parser may have lost every domain. */
export function StudioRuntimeNotice() {
  const { data } = useStudioRuntime()
  if (!data || data.runningVersion === data.installedVersion) return null
  const command = data.restartCommand.map((part) => `'${part.replaceAll("'", `'"'"'`)}'`).join(' ')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      toast.success('Restart command copied')
    } catch {
      toast.error('Copy failed — select the command and copy it manually')
    }
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Restart Studio
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-80 space-y-3 p-3">
        <p className="text-xs leading-5">
          Studio is running {data.runningVersion}. The installed CLI is {data.installedVersion}.
          Reopen Studio to use the installed version and its parser.
        </p>
        <code className="block overflow-x-auto whitespace-nowrap rounded-md border bg-muted/40 p-2 font-mono text-[11px] text-foreground">
          {command}
        </code>
        <Button size="sm" className="w-full" onClick={() => void copy()}>
          <Copy /> Copy restart command
        </Button>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Finish active agent turns and save drafts before stopping Studio.
        </p>
      </PopoverContent>
    </Popover>
  )
}
