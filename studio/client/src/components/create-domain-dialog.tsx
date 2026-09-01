import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'

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

/** create-astrale-domain's slug shape (kept in sync with the server guard). */
const SLUG = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

/** Scaffold a brand new domain in the workspace folder — the rail's plus button. */
export function CreateDomainDialog({
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
                  <span className="text-muted-foreground"> · placeholder, edit later</span>
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
