import { useQueryClient } from '@tanstack/react-query'
import { Boxes, Check, ChevronsUpDown, FolderPlus, Layers3, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import { selectionForActiveDomain, useSchemaWorkspace } from '@/schema-studio/workspace/store'

import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/** create-astrale-domain's slug shape (kept in sync with the server guard). */
const SLUG = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

/** The unified active-domain and schema-composition selector. */
export function DomainSelector() {
  const { data: domains } = useWorkspace()
  const domainId = useUI((s) => s.domainId)
  const setDomain = useUI((s) => s.setDomain)
  const setSection = useUI((s) => s.setSection)
  const selectedDomainIds = useSchemaWorkspace((state) => state.selectedDomainIds)
  const replaceDomains = useSchemaWorkspace((state) => state.replaceDomains)
  const toggleDomain = useSchemaWorkspace((state) => state.toggleDomain)
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const active = domains?.find((d) => d.id === domainId)
  const validIds = useMemo(() => new Set((domains ?? []).map((domain) => domain.id)), [domains])

  useEffect(() => {
    if (!domainId || !domains) return
    const next = selectedDomainIds.filter((id) => validIds.has(id))
    if (!next.includes(domainId)) next.unshift(domainId)
    if (
      next.length !== selectedDomainIds.length ||
      next.some((id, index) => id !== selectedDomainIds[index])
    ) {
      replaceDomains(next)
    }
  }, [domainId, domains, replaceDomains, selectedDomainIds, validIds])

  const selected = new Set(selectedDomainIds)
  if (domainId) selected.add(domainId)
  const canvasCount = selected.size

  const activateDomain = (nextDomainId: string) => {
    replaceDomains(
      domainId ? selectionForActiveDomain([...selected], domainId, nextDomainId) : [nextDomainId],
    )
    setDomain(nextDomainId)
    setOpen(false)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="domain-selector"
            title="Domain canvas — choose the active domain and optional companions"
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-lg border pl-1.5 pr-2 text-sm font-medium outline-none transition-colors',
              canvasCount > 1
                ? 'border-sky-400/35 bg-sky-400/10 text-sky-100 hover:bg-sky-400/15'
                : 'bg-card hover:bg-accent/50',
            )}
          >
            <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
              <Boxes className="h-3.5 w-3.5" />
            </span>
            <span className="max-w-[15rem] truncate">{active?.origin ?? 'select domain'}</span>
            <span
              className={cn(
                'inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[10px] tabular-nums',
                canvasCount > 1 ? 'bg-sky-300/15 text-sky-100' : 'bg-muted text-muted-foreground',
              )}
            >
              <Layers3 className="h-3 w-3" /> {canvasCount}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-1.5">
          <div className="flex items-start justify-between gap-3 px-2 pb-2 pt-1">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Domain canvas
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/70">
                Open one domain, then check companions to compose their schemas.
              </p>
            </div>
            {!!domains?.length && (
              <button
                type="button"
                onClick={() => replaceDomains(domains.map((domain) => domain.id))}
                className="shrink-0 rounded-md px-1.5 py-1 text-[10px] font-medium text-sky-300 hover:bg-sky-400/10"
              >
                Select all
              </button>
            )}
          </div>
          <div className="max-h-[50vh] space-y-0.5 overflow-y-auto">
            {(domains ?? []).map((d) => {
              const checked = selected.has(d.id)
              const isActive = d.id === domainId
              return (
                <div
                  key={d.id}
                  className={cn(
                    'flex items-center gap-1 rounded-md transition-colors',
                    checked ? 'bg-accent/55' : 'hover:bg-accent/35',
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-label={
                      isActive
                        ? `${d.origin} is the active domain on canvas`
                        : `${checked ? 'Remove' : 'Add'} ${d.origin} ${checked ? 'from' : 'to'} canvas`
                    }
                    aria-checked={checked}
                    disabled={isActive}
                    title={isActive ? 'The active domain is always on the canvas' : undefined}
                    onClick={() => domainId && toggleDomain(d.id, domainId)}
                    className="group ml-2 grid h-5 w-5 shrink-0 place-items-center rounded border border-border text-transparent transition-colors enabled:hover:border-sky-400/60 disabled:cursor-default"
                  >
                    {checked && (
                      <span className="grid h-full w-full place-items-center rounded bg-sky-400/15 text-sky-200">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => activateDomain(d.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{d.origin}</span>
                      <span className="block truncate text-[10px] text-muted-foreground/65">
                        {d.path.split('/').pop()}
                        {!d.depsInstalled && ' · deps missing'}
                      </span>
                    </span>
                    {isActive && (
                      <span className="rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                        active
                      </span>
                    )}
                  </button>
                </div>
              )
            })}
            {!domains?.length && (
              <div className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                No domains found
              </div>
            )}
          </div>
          <div className="my-1 h-px bg-border/60" />
          {domainId && canvasCount > 1 && (
            <button
              type="button"
              onClick={() => replaceDomains([domainId])}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              Show only {active?.origin ?? 'active domain'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setCreateOpen(true)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              <FolderPlus className="h-3.5 w-3.5" />
            </span>
            Create new domain
          </button>
        </PopoverContent>
      </Popover>

      <CreateDomainDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          replaceDomains([id])
          setDomain(id)
          setSection('context')
        }}
      />
    </>
  )
}

function CreateDomainDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (id: string) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slug = name.trim().toLowerCase()
  const valid = !!slug && slug.length <= 64 && SLUG.test(slug)
  const origin = slug ? (slug.includes('.') ? slug : `${slug}.example.dev`) : ''

  const reset = () => {
    setName('')
    setError(null)
    setBusy(false)
  }
  // ignore close attempts while a scaffold is running (Esc / overlay / Cancel)
  const onClose = (o: boolean) => {
    if (busy) return
    if (!o) reset()
    onOpenChange(o)
  }

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.createDomain(slug)
      if (r.ok && r.id) {
        await qc.invalidateQueries({ queryKey: qk.workspace })
        onCreated(r.id)
        toast.success(`Created ${r.origin ?? slug}`)
        reset()
        onOpenChange(false)
      } else {
        setError(r.error || 'Could not create the domain — check the studio logs.')
      }
    } catch (e) {
      setError((e as Error)?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create a new domain</DialogTitle>
          <DialogDescription>
            Scaffolds a fresh Astrale domain with{' '}
            <span className="font-mono text-[12px]">create-astrale-domain</span> and installs its
            dependencies.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <label
              htmlFor="new-domain-name"
              className="text-[12px] font-medium text-muted-foreground"
            >
              Domain name
            </label>
            <Input
              id="new-domain-name"
              autoFocus
              value={name}
              disabled={busy}
              placeholder="crm"
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
          </div>

          {slug && valid && (
            <div className="space-y-0.5 rounded-lg border bg-muted/30 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
              <div>
                origin <span className="font-mono text-foreground">{origin}</span>
                {!slug.includes('.') && (
                  <span className="text-muted-foreground/70"> · placeholder, edit later</span>
                )}
              </div>
              <div>
                folder <span className="font-mono text-foreground">{slug}/</span> · managed
                (astrale) adapter
              </div>
            </div>
          )}
          {slug && !valid && (
            <p className="text-[12px] text-destructive">
              Use lowercase letters, digits, dots and dashes.
            </p>
          )}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] leading-relaxed text-destructive">
              {error}
            </div>
          )}
          {busy && (
            <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scaffolding and installing
              dependencies — this can take a moment…
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Creating…
              </>
            ) : (
              'Create domain'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
