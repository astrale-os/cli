import type { AnchorRef, Integration } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { Plug, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Commentable } from '@/components/commentable'
import {
  Chip,
  DetailsDisclosure,
  EmptyState,
  IconTile,
  Row,
  SectionShell,
} from '@/components/studio-kit'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/misc'
import { Textarea } from '@/components/ui/textarea'
import { api, qk } from '@/lib/api'
import { useIntegrations } from '@/lib/hooks'

/** Map a status to a soft chip tone. */
function statusTone(status: string): 'default' | 'success' | 'warning' {
  if (status === 'active') return 'success'
  if (status === 'deprecated') return 'warning'
  return 'default'
}

/** ─────────────────────────── Add dialog (the only authoring UI) ─────────────────────────── */
function AddIntegrationDialog({ domainId }: { domainId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('planned')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  function reset() {
    setName('')
    setKind('')
    setStatus('planned')
    setNotes('')
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !kind.trim()) {
      toast.error('Name and kind are required')
      return
    }
    setBusy(true)
    try {
      await api.upsertIntegration(domainId, {
        name: name.trim(),
        kind: kind.trim(),
        status: status.trim() || 'planned',
        notes: notes.trim() || undefined,
      })
      await qc.invalidateQueries({ queryKey: qk.integrations(domainId) })
      toast.success(`Added "${name.trim()}"`)
      reset()
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add integration')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus />
        Add
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add integration</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="int-name">Name</Label>
              <Input
                id="int-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Stripe, Slack…"
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="int-kind">Kind</Label>
              <Input
                id="int-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                placeholder="payments, db…"
                className="font-mono"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="int-status">Status</Label>
            <Input
              id="int-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="planned"
              list="int-status-options"
              autoComplete="off"
            />
            <datalist id="int-status-options">
              <option value="planned" />
              <option value="active" />
              <option value="deprecated" />
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="int-notes">Notes</Label>
            <Textarea
              id="int-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional — auth model, env vars, gotchas…"
              className="min-h-16 font-sans"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Adding…' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** ─────────────────────────── A single integration row ─────────────────────────── */
function IntegrationRow({ domainId, item }: { domainId: string; item: Integration }) {
  const qc = useQueryClient()

  async function onDelete() {
    try {
      await api.deleteIntegration(domainId, item.id)
      await qc.invalidateQueries({ queryKey: qk.integrations(domainId) })
      toast.success(`Removed "${item.name}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove integration')
    }
  }

  const anchor: AnchorRef = { ref: `section.integrations.${item.id}`, kind: 'section' }

  return (
    <Commentable anchor={anchor} excerpt={`${item.name} — ${item.kind}`}>
      <Row
        leading={
          <IconTile tone="muted">
            <Plug />
          </IconTile>
        }
        title={
          <span className="flex items-center gap-2">
            {item.name}
            <Chip tone={statusTone(item.status)}>{item.status}</Chip>
          </span>
        }
        subtitle={item.notes || undefined}
        trailing={
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${item.name}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/row:opacity-100 [&_svg]:h-4 [&_svg]:w-4"
          >
            <Trash2 />
          </button>
        }
      />
    </Commentable>
  )
}

export function IntegrationsSection({ domainId }: { domainId: string }) {
  const { data, isLoading } = useIntegrations(domainId)

  const integrations = data?.integrations ?? []
  const detected = data?.detectedSubfolders ?? []

  return (
    <SectionShell
      title="Integrations"
      subtitle="External services this domain talks to."
      actions={<AddIntegrationDialog domainId={domainId} />}
    >
      {isLoading ? (
        <p className="px-1 text-sm text-muted-foreground">Loading integrations…</p>
      ) : integrations.length === 0 ? (
        <EmptyState
          icon={<Plug />}
          title="No integrations yet"
          hint="A hand-maintained list of external systems this domain talks to."
        />
      ) : (
        <div className="flex flex-col gap-px">
          {integrations.map((item) => (
            <IntegrationRow key={item.id} domainId={domainId} item={item} />
          ))}
        </div>
      )}

      {detected.length > 0 && (
        <div className="mt-8">
          <DetailsDisclosure label={`Detected in integrations/ (${detected.length})`}>
            <div className="flex flex-wrap gap-1.5 pl-1">
              {detected.map((folder) => (
                <span
                  key={folder}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  {folder}
                </span>
              ))}
            </div>
            <p className="mt-2 pl-1 text-xs text-muted-foreground/60">
              Directory listing only — not parsed from code.
            </p>
          </DetailsDisclosure>
        </div>
      )}
    </SectionShell>
  )
}
