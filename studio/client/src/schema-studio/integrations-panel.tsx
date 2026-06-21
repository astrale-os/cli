import { Plug, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Commentable } from '@/components/commentable'
import { IconTile } from '@/components/studio-kit'
import { ScrollArea, Separator } from '@/components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAnatomy, useCommentMutations, useComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'

/**
 * IntegrationsPanel — the external-service integrations overview in the RIGHT PANEL
 * (opened from the canvas "Integrations" button). Shows what's actually wired in the
 * (configurable) integrations/ folder, plus any open "please add X" requests. Requesting
 * one drops an agent-readable comment on the canvas — the SAME primitive as domain
 * imports; no dedicated page.
 */

const REQUEST_PREFIX = 'integration.request.'
const requestAnchor = (slug: string) => `${REQUEST_PREFIX}${slug}`
const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'integration'

function DetectedRow({ name }: { name: string }) {
  return (
    <Commentable
      anchor={{ ref: `section.integrations.${name}`, kind: 'section' }}
      excerpt={`${name} integration`}
    >
      <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
        <IconTile tone="emerald" size="sm">
          <Plug />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-tight">{name}</div>
          <div className="text-[11px] text-muted-foreground/70 leading-tight">in integrations/</div>
        </div>
      </div>
    </Commentable>
  )
}

function RequestedRow({ slug, label }: { slug: string; label: string }) {
  return (
    <Commentable
      anchor={{ ref: requestAnchor(slug), kind: 'section' }}
      excerpt={`Add ${label} integration`}
    >
      <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
        <IconTile tone="amber" size="sm">
          <Plug />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-tight">{label}</div>
          <div className="text-[11px] text-muted-foreground/70 leading-tight">requested</div>
        </div>
      </div>
    </Commentable>
  )
}

/** Free-text "request an integration" → an agent-readable comment anchored on the canvas. */
function RequestButton({ domainId, taken }: { domainId: string; taken: Set<string> }) {
  const { create } = useCommentMutations(domainId)
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [why, setWhy] = useState('')

  const submit = () => {
    const n = name.trim()
    if (!n) return
    const ref = requestAnchor(slugify(n))
    const text = `Add a "${n}" integration under the integrations/ folder${why.trim() ? ` — ${why.trim()}` : ''}. Wire it up the Astrale way (DI, secrets, idempotency).`
    create.mutate(
      {
        anchors: [n],
        anchorRefs: [{ ref, kind: 'section' }],
        text,
        firstRole: 'user',
        type: 'text',
      },
      {
        onSuccess: () => {
          setName('')
          setWhy('')
          setOpen(false)
          setOpenAnchor(ref)
          toast.success('Integration requested — add the why/how in the comment')
        },
        onError: (err) => toast.error(String(err)),
      },
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Request an integration
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 p-2.5">
        <div className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Request an integration
        </div>
        <input
          // biome-ignore lint/a11y/noAutofocus: composer opens on explicit click
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="Name (e.g. Stripe)"
          className="mb-1.5 w-full rounded-md border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary"
        />
        <textarea
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="Why / what for (optional)"
          rows={2}
          className="mb-2 w-full resize-none rounded-md border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim() || create.isPending}
          className="w-full rounded-md bg-primary px-2 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Request
        </button>
        {taken.size > 0 && (
          <p className="pt-2 text-[10px] leading-snug text-muted-foreground/50">
            Already present: {[...taken].join(', ')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function IntegrationsPanel({ domainId }: { domainId: string }) {
  const { data: anatomy } = useAnatomy(domainId)
  const { data: comments } = useComments(domainId)
  const detected = anatomy?.detectedIntegrations ?? []
  const detectedSet = useMemo(() => new Set(detected), [detected])

  // requested = open integration-request comments not yet present on disk
  const requested = useMemo(() => {
    const seen = new Set<string>()
    const out: { slug: string; label: string }[] = []
    for (const c of comments?.comments ?? []) {
      if (c.status !== 'open') continue
      for (const a of c.anchorRefs) {
        if (!a.ref.startsWith(REQUEST_PREFIX)) continue
        const slug = a.ref.slice(REQUEST_PREFIX.length)
        if (detectedSet.has(slug) || seen.has(slug)) continue
        seen.add(slug)
        out.push({ slug, label: c.anchors[0] ?? slug })
      }
    }
    return out
  }, [comments, detectedSet])

  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        <div className="mb-5 flex items-baseline gap-2 pr-8">
          <h1 className="text-base font-semibold">Integrations</h1>
          <span className="text-xs text-muted-foreground">{detected.length}</span>
        </div>

        {detected.length > 0 && (
          <>
            <div className="px-1.5 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Detected
            </div>
            <div className="flex flex-col gap-0.5">
              {detected.map((n) => (
                <DetectedRow key={n} name={n} />
              ))}
            </div>
          </>
        )}

        {requested.length > 0 && (
          <>
            {detected.length > 0 && <Separator className="my-2 opacity-60" />}
            <div className="px-1.5 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Requested
            </div>
            <div className="flex flex-col gap-0.5">
              {requested.map((r) => (
                <RequestedRow key={r.slug} slug={r.slug} label={r.label} />
              ))}
            </div>
          </>
        )}

        {detected.length === 0 && requested.length === 0 && (
          <p className="px-2 pb-1 pt-0.5 text-[11px] text-muted-foreground/60">
            No integrations detected.
          </p>
        )}

        <Separator className="my-3 opacity-60" />
        <RequestButton domainId={domainId} taken={detectedSet} />
      </div>
    </ScrollArea>
  )
}
