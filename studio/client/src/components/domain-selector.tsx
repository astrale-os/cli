import { useQueryClient } from '@tanstack/react-query'
import { Boxes, Check, ChevronsUpDown, FolderPlus, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

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

/**
 * The domain switcher (top-left, after the instance). A custom Popover list of
 * the workspace's domains + a "Create new" action that scaffolds a fresh domain
 * via `create-astrale-domain` (server-side) and selects it when ready.
 */
export function DomainSelector() {
  const { data: domains } = useWorkspace()
  const domainId = useUI((s) => s.domainId)
  const setDomain = useUI((s) => s.setDomain)
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const active = domains?.find((d) => d.id === domainId)

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Domain — switch or create"
            className="inline-flex h-8 items-center gap-2 rounded-lg border bg-card pl-1.5 pr-2.5 text-sm font-medium outline-none transition-colors hover:bg-accent/50"
          >
            <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
              <Boxes className="h-3.5 w-3.5" />
            </span>
            <span className="max-w-[15rem] truncate">{active?.origin ?? 'select domain'}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-1.5">
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Domains
          </div>
          <div className="max-h-[50vh] space-y-0.5 overflow-y-auto">
            {(domains ?? []).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setDomain(d.id)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                  d.id === domainId && 'bg-accent/40',
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {d.id === domainId && <Check className="h-3.5 w-3.5 text-primary" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.origin}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {d.path.split('/').pop()}
                    {!d.depsInstalled && ' · deps not installed'}
                  </span>
                </span>
              </button>
            ))}
            {!domains?.length && (
              <div className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                No domains found
              </div>
            )}
          </div>
          <div className="my-1 h-px bg-border/60" />
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

      <CreateDomainDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setDomain} />
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
