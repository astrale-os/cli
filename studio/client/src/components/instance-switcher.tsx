import type { InstanceInfo } from '@shared/contracts/workspace'

import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, ExternalLink, Loader2, Server, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useInstances } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

function instancePageUrl(url?: string | null): string | null {
  const raw = url?.trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    if (parsed.pathname === '/api' || parsed.pathname === '/api/') parsed.pathname = '/'
    return parsed.href.replace(/\/$/, '')
  } catch {
    return raw.replace(/\/api\/?$/, '')
  }
}

const NOT_OWNER = 'Not owner'

/** Why the active instance is a problem for Studio, or `null` when the user owns it. */
export function activeInstanceWarning(instances: readonly InstanceInfo[]): string | null {
  const current = instances.find((instance) => instance.active)
  if (!current || current.owned) return null
  return `You are not the owner of ${current.name} in Admin (${current.reason ?? NOT_OWNER}). Its Views cannot be opened in Studio.`
}

/**
 * Top-left: the GLOBAL active Astrale instance, with a switcher. Backed entirely
 * by the `astrale` CLI (`instance list` / `instance use`) — the studio keeps no
 * instance state of its own. Independent of the selected domain.
 *
 * Studio works only with the instances its user owns in Admin. The others stay
 * listed, so nothing seems to vanish, but cannot be picked; an active one set
 * from a terminal carries a warning, since Studio will not open its Views.
 */
export function InstanceSwitcher() {
  const { data, isPending } = useInstances()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const active = data?.active ?? null
  const instances = data?.instances ?? []

  const pick = async (name: string) => {
    if (name === active || switching) return
    if (!instances.find((instance) => instance.name === name)?.owned) return
    setSwitching(name)
    try {
      const r = await api.switchInstance(name)
      if (r.ok) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: qk.instances }),
          qc.invalidateQueries({ queryKey: ['view-runtime'] }),
        ])
        toast.success(`Switched to ${r.active ?? name}`)
        setOpen(false)
      } else {
        toast.error(`Couldn't switch: ${r.output.split('\n').filter(Boolean).pop() ?? 'failed'}`)
      }
    } finally {
      setSwitching(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="-ml-1 inline-flex items-center gap-0.5">
        <InstanceTrigger
          active={active}
          loading={isPending}
          warning={activeInstanceWarning(instances)}
        />
      </div>
      <PopoverContent align="start" className="w-72 p-1.5">
        <InstanceList
          instances={instances}
          loading={isPending}
          switching={switching}
          onPick={pick}
        />
      </PopoverContent>
    </Popover>
  )
}

function InstanceTrigger({
  active,
  loading,
  warning,
}: {
  active: string | null
  loading: boolean
  warning: string | null
}) {
  return (
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-busy={loading || undefined}
        title={loading ? 'Loading instances' : (warning ?? 'Active instance — click to switch')}
        className="inline-flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-accent/50"
      >
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
          <Server className="h-4 w-4" />
        </span>
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading instances…
          </span>
        ) : (
          <span className="font-semibold tracking-tight">{active ?? 'no instance'}</span>
        )}
        {warning && (
          <TriangleAlert
            className="h-3.5 w-3.5 text-warning"
            role="img"
            aria-label="You are not the owner of the active instance"
          />
        )}
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </PopoverTrigger>
  )
}

/** The popover's body: an owned instance is a choice, any other one only an explanation. */
export function InstanceList({
  instances,
  loading = false,
  switching,
  onPick,
}: {
  instances: readonly InstanceInfo[]
  loading?: boolean
  switching: string | null
  onPick: (name: string) => void
}) {
  const warning = activeInstanceWarning(instances)
  return (
    <>
      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Active instance
      </div>
      {warning && (
        <div
          role="alert"
          className="mx-1 mb-1 flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] leading-snug"
        >
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
          <span>{warning}</span>
        </div>
      )}
      <div className="space-y-0.5">
        {instances.map((i) => {
          const openUrl = instancePageUrl(i.url)
          const reason = i.owned ? undefined : (i.reason ?? NOT_OWNER)
          return (
            <div
              key={i.name}
              className={cn(
                'flex w-full items-center gap-1 rounded-md transition-colors',
                i.owned && 'hover:bg-accent',
                i.active && 'bg-accent/40',
              )}
            >
              <button
                type="button"
                onClick={() => onPick(i.name)}
                disabled={!i.owned}
                title={reason && `${reason}: Studio works only with instances you own in Admin`}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left disabled:cursor-not-allowed"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {switching === i.name ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  ) : i.active && i.owned ? (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  ) : i.active ? (
                    <TriangleAlert className="h-3.5 w-3.5 text-warning" />
                  ) : null}
                </span>
                <span className={cn('min-w-0 flex-1', reason && 'opacity-60')}>
                  <span className="block truncate text-sm font-medium">{i.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {openUrl ? openUrl.replace(/^https?:\/\//, '') : 'no URL'}
                  </span>
                </span>
                {(reason || i.kind === 'managed') && (
                  <span className="max-w-24 shrink-0 truncate text-[9px] uppercase tracking-wide text-muted-foreground">
                    {reason ?? 'managed'}
                  </span>
                )}
              </button>
              {openUrl && (
                <a
                  href={openUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${i.name} in a new tab`}
                  className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )
        })}
        {loading ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 px-2 py-3 text-[12px] text-muted-foreground"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading instances…
          </div>
        ) : (
          instances.length === 0 && (
            <div className="px-2 py-3 text-center text-[12px] text-muted-foreground">
              No instances found
            </div>
          )
        )}
      </div>
    </>
  )
}
