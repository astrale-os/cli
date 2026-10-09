import type { StaleReport } from '@shared/types'

import { ArrowUpCircle, Copy, PackageOpen } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useChatMutations } from '@/lib/chats'
import { useUpdates } from '@/lib/hooks'
import { useUI } from '@/lib/store'

/**
 * A quiet, per-domain signal: package drift belongs beside the domain it affects,
 * not in the global header. Opening it only explains the drift. The explicit
 * action creates a fresh chat and prepares a message; it never submits a turn.
 */
export function DomainPackageUpdates({ domainId, origin }: { domainId: string; origin: string }) {
  const { data } = useUpdates(domainId)
  const { open } = useChatMutations()
  const setAgentDraft = useUI((state) => state.setAgentDraft)
  const setPanelTab = useUI((state) => state.setPanelTab)
  const [opened, setOpened] = useState(false)
  const outdated = data?.sdk.outdated ?? []

  if (outdated.length === 0) return null

  const prepare = async () => {
    try {
      const chat = await open.mutateAsync(undefined)
      setAgentDraft(chat.id, packageUpdatePrompt(origin, data!))
      setPanelTab('agent')
      setOpened(false)
      toast.success('Update request ready — review it, then send when you are ready')
    } catch {
      // useChatMutations owns the actionable error toast.
    }
  }

  return (
    <Popover open={opened} onOpenChange={setOpened}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${outdated.length} Astrale package update${outdated.length === 1 ? '' : 's'} available for ${origin}`}
          title={packageUpdateSummary(data!)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-warning transition-colors hover:bg-warning/10 hover:text-warning"
        >
          <PackageOpen className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-80 space-y-3 p-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Astrale packages
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {origin} has {outdated.length} package update{outdated.length === 1 ? '' : 's'}{' '}
            available.
          </p>
        </div>

        <div className="space-y-1.5 rounded-md border border-warning/20 bg-warning/[0.04] p-2">
          {outdated.map((item) => (
            <div key={item.pkg} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="min-w-0 truncate font-mono text-foreground">{item.pkg}</span>
              <span className="shrink-0 font-mono text-muted-foreground">
                {item.current} → {item.latest}
              </span>
            </div>
          ))}
        </div>

        <Button
          size="sm"
          className="w-full"
          disabled={open.isPending}
          onClick={() => void prepare()}
        >
          Prepare update with agent
        </Button>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Opens a new agent chat with an unsent request. You can review or edit it before sending.
        </p>
      </PopoverContent>
    </Popover>
  )
}

/** CLI and skill updates still require leaving the running Studio process. Package
 * drift is deliberately excluded here; it belongs to its domain row above. */
export function UpdatesBadge({ domainId, domainPath }: { domainId: string; domainPath: string }) {
  const { data } = useUpdates(domainId)
  const actionable =
    !!data &&
    ((data.cli.stale && !data.cli.managed) ||
      data.skills.status === 'update-available' ||
      data.skills.status === 'repair-needed')
  if (!data || !actionable) return null

  const command = `cd ${shellQuote(domainPath)} && astrale update`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      toast.success('Update command copied')
    } catch {
      toast.error('Copy failed — select the command and copy it manually')
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Astrale CLI or skills update available"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
        >
          <ArrowUpCircle className="h-3.5 w-3.5" />
          <span>Update</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-80 space-y-3 p-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Studio update
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Stop Studio before updating its CLI or installed skills.
          </p>
        </div>
        <code className="block overflow-x-auto whitespace-nowrap rounded-md border bg-muted/40 p-2 font-mono text-[11px] text-foreground">
          {command}
        </code>
        <Button size="sm" className="w-full" onClick={() => void copy()}>
          <Copy /> Copy command
        </Button>
      </PopoverContent>
    </Popover>
  )
}

export function packageUpdatePrompt(origin: string, report: StaleReport): string {
  const packages = report.sdk.outdated
    .map((item) => `- ${item.pkg}: ${item.current} → ${item.latest}`)
    .join('\n')
  return `Update the Astrale packages for the ${origin} domain to these exact versions:\n${packages}\n\nInstall the updated dependencies, make any required migrations, and run the domain's checks. Do not change unrelated packages.`
}

export function packageUpdateSummary(report: StaleReport): string {
  return report.sdk.outdated
    .map((item) => `${item.pkg} ${item.current} → ${item.latest}`)
    .join(' · ')
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
