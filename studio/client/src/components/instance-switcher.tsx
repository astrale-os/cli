import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, ExternalLink, Loader2, Server } from 'lucide-react'
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

/**
 * Top-left: the GLOBAL active Astrale instance, with a switcher. Backed entirely
 * by the `astrale` CLI (`instance list` / `instance use`) — the studio keeps no
 * instance state of its own. Independent of the selected domain.
 */
export function InstanceSwitcher() {
  const { data } = useInstances()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const active = data?.active ?? null
  const instances = data?.instances ?? []

  const pick = async (name: string) => {
    if (name === active || switching) return
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
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Active instance — click to switch"
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-accent/50"
          >
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <Server className="h-4 w-4" />
            </span>
            <span className="font-semibold tracking-tight">{active ?? 'no instance'}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent align="start" className="w-64 p-1.5">
        <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Active instance
        </div>
        <div className="space-y-0.5">
          {instances.map((i) => {
            const openUrl = instancePageUrl(i.url)
            return (
              <div
                key={i.name}
                className={cn(
                  'flex w-full items-center gap-1 rounded-md transition-colors hover:bg-accent',
                  i.active && 'bg-accent/40',
                )}
              >
                <button
                  type="button"
                  onClick={() => pick(i.name)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {switching === i.name ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : i.active ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{i.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {openUrl ? openUrl.replace(/^https?:\/\//, '') : 'no URL'}
                    </span>
                  </span>
                  {i.kind === 'managed' && (
                    <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">
                      managed
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
          {instances.length === 0 && (
            <div className="px-2 py-3 text-center text-[12px] text-muted-foreground">
              No instances found
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
