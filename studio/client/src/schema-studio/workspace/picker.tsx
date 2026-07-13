import { Check, Layers3 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { useSchemaWorkspace } from './store'

export function WorkspaceDomainPicker() {
  const { data: domains } = useWorkspace()
  const primaryDomainId = useUI((state) => state.domainId)
  const selectedDomainIds = useSchemaWorkspace((state) => state.selectedDomainIds)
  const replaceDomains = useSchemaWorkspace((state) => state.replaceDomains)
  const toggleDomain = useSchemaWorkspace((state) => state.toggleDomain)
  const [open, setOpen] = useState(false)

  const validIds = useMemo(() => new Set((domains ?? []).map((domain) => domain.id)), [domains])

  useEffect(() => {
    if (!primaryDomainId || !domains) return
    const next = selectedDomainIds.filter((id) => validIds.has(id))
    if (!next.includes(primaryDomainId)) next.unshift(primaryDomainId)
    if (
      next.length !== selectedDomainIds.length ||
      next.some((id, index) => id !== selectedDomainIds[index])
    ) {
      replaceDomains(next)
    }
  }, [domains, primaryDomainId, replaceDomains, selectedDomainIds, validIds])

  if (!primaryDomainId || !domains?.length) return null

  const selected = new Set(selectedDomainIds)
  selected.add(primaryDomainId)
  const count = selected.size

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="workspace-domain-picker"
          title="Choose domains rendered together on the Schema canvas"
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm font-medium outline-none transition-colors',
            count > 1
              ? 'border-sky-400/35 bg-sky-400/10 text-sky-200 hover:bg-sky-400/15'
              : 'bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <Layers3 className="h-3.5 w-3.5" />
          <span>Canvas</span>
          <span
            className={cn(
              'grid min-w-5 place-items-center rounded-full px-1 text-[10px] tabular-nums',
              count > 1 ? 'bg-sky-300/15 text-sky-100' : 'bg-muted text-muted-foreground',
            )}
          >
            {count}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5">
        <div className="flex items-start justify-between gap-3 px-2 pb-2 pt-1">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Schema workspace
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/70">
              Combine schemas while keeping actions bound to their owning domain.
            </p>
          </div>
          <button
            type="button"
            onClick={() => replaceDomains(domains.map((domain) => domain.id))}
            className="shrink-0 rounded-md px-1.5 py-1 text-[10px] font-medium text-sky-300 hover:bg-sky-400/10"
          >
            Select all
          </button>
        </div>

        <div className="max-h-[55vh] space-y-0.5 overflow-y-auto">
          {domains.map((domain) => {
            const checked = selected.has(domain.id)
            const primary = domain.id === primaryDomainId
            return (
              <button
                key={domain.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={primary}
                data-domain-id={domain.id}
                onClick={() => toggleDomain(domain.id, primaryDomainId)}
                className={cn(
                  'group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                  checked ? 'bg-accent/55' : 'hover:bg-accent/35',
                  primary && 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
                    checked
                      ? 'border-sky-400/60 bg-sky-400/15 text-sky-200'
                      : 'border-border text-transparent group-hover:border-muted-foreground/50',
                  )}
                >
                  {checked && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{domain.origin}</span>
                  <span className="block truncate text-[10px] text-muted-foreground/65">
                    {domain.path.split('/').pop()}
                    {!domain.depsInstalled && ' · deps missing'}
                  </span>
                </span>
                {primary && (
                  <span className="rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                    active
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {count > 1 && (
          <div className="mt-1 border-t px-2 pt-1.5">
            <button
              type="button"
              onClick={() => {
                replaceDomains([primaryDomainId])
                setOpen(false)
              }}
              className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Show only active domain
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
