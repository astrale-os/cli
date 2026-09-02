import type { DomainCatalogEntry, VisibilityState } from '@shared/types'

import { Eye, EyeOff, Globe, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'

import { Commentable } from '@/components/commentable'
import { DescriptionText, IconTile } from '@/components/studio-kit'
import { ScrollArea, Separator } from '@/components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useBundle, useCatalog, useCommentMutations, useComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { anchorKey } from '@/lib/targets'
import { cn } from '@/lib/utils'

import { type ExternalDomain, externalDomains } from './external'
import { SchemaIcon } from './schema-icon'
import { domainRef, isHidden } from './visibility'

/**
 * DomainsPanel — the "Imported domains" overview in the RIGHT PANEL (opened from the
 * canvas "Domains" button). It shows the domains THIS one truly imports (schema ground
 * truth) with per-domain show/hide, and turns an "import this" wish into an agent-readable
 * comment that lives on the canvas — no separate page.
 */

/** The canvas anchor an import-request comment shares with its "Requested" row. */
const IMPORT_PREFIX = 'domain.import.'
const importAnchor = (origin: string) => `${IMPORT_PREFIX}${origin}`

/** Resolve a domain's display name + SVG icon from the catalog, falling back to its origin. */
function useResolve() {
  const { data: catalog } = useCatalog()
  const byOrigin = new Map((catalog ?? []).map((e) => [e.origin, e]))
  return (origin: string): Pick<DomainCatalogEntry, 'name' | 'icon'> & { description?: string } =>
    byOrigin.get(origin) ?? { name: origin.split('.')[0] || origin, icon: '' }
}

function DomainRow({
  domain,
  hidden,
  onToggleHidden,
}: {
  domain: ExternalDomain
  hidden: boolean
  onToggleHidden: (ref: string) => void
}) {
  const resolve = useResolve()
  const entry = resolve(domain.origin)
  const tone = domain.kind === 'kernel' ? 'violet' : 'emerald'
  const count = domain.members.length
  // Linked = a relationship reaches it, which is what the canvas can draw. The rest is
  // imported and used elsewhere — still a dependency, and still this domain's business.
  const linked = domain.members.filter((member) => member.connected).length

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg px-1.5 py-1 transition-opacity',
        hidden && 'opacity-50',
      )}
    >
      <IconTile tone={tone} size="sm">
        {entry.icon ? <SchemaIcon svg={entry.icon} className="h-3.5 w-3.5" /> : <Globe />}
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-tight">{entry.name}</div>
        <div className="text-[11px] text-muted-foreground leading-tight">
          {count} {count === 1 ? 'type' : 'types'}
          {linked > 0 && ` · ${linked} linked`}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onToggleHidden(domainRef(domain.origin))}
        title={hidden ? 'Show in canvas' : 'Hide in canvas'}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

/** A pending "please import X" wish — an open comment the agent reads; its thread opens inline here. */
function RequestedRow({ domainId, origin }: { domainId: string; origin: string }) {
  const resolve = useResolve()
  const entry = resolve(origin)
  return (
    <Commentable
      domainId={domainId}
      anchor={{ ref: importAnchor(origin), kind: 'section' }}
      excerpt={`Import ${entry.name}`}
    >
      <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
        <IconTile tone="edge" size="sm">
          {entry.icon ? <SchemaIcon svg={entry.icon} className="h-3.5 w-3.5" /> : <Globe />}
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-tight">{entry.name}</div>
          <div className="text-[11px] text-muted-foreground leading-tight">import requested</div>
        </div>
      </div>
    </Commentable>
  )
}

function ImportButton({ domainId, taken }: { domainId: string; taken: Set<string> }) {
  const { data: catalog } = useCatalog()
  const { create } = useCommentMutations(domainId)
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)

  // Import = drop an agent-readable comment anchored on the canvas, then open it so
  // the user can spell out the why/how. The agent reads open threads and does the import.
  const requestImport = (e: DomainCatalogEntry) => {
    const ref = importAnchor(e.origin)
    create.mutate(
      {
        anchors: [e.origin],
        anchorRefs: [{ ref, kind: 'section' }],
        text: `Import the ${e.name} domain (${e.origin}) — add it to this domain's imports and wire up the types we depend on.`,
        firstRole: 'user',
        type: 'text',
      },
      {
        onSuccess: () => {
          setOpenAnchor(anchorKey(domainId, ref))
          toast.success('Import requested — add the why/how in the comment')
        },
        onError: (err) => toast.error(String(err)),
      },
    )
  }

  const available = (catalog ?? []).filter(
    (e) => e.kind !== 'kernel' && e.origin !== domainId && !taken.has(e.origin),
  )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Import a domain
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 p-1.5">
        <div className="px-1.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Catalog
        </div>
        {available.length === 0 ? (
          <div className="px-1.5 py-3 text-center text-xs text-muted-foreground">
            Everything imported
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {available.map((e) => (
              <button
                key={e.origin}
                type="button"
                onClick={() => requestImport(e)}
                disabled={create.isPending}
                className="group/imp flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-accent/60 disabled:opacity-50"
              >
                <IconTile tone={e.kind === 'external' ? 'emerald' : 'sky'} size="sm">
                  {e.icon ? <SchemaIcon svg={e.icon} className="h-3.5 w-3.5" /> : <Globe />}
                </IconTile>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium leading-tight">{e.name}</div>
                  <DescriptionText className="truncate text-[11px] leading-tight text-muted-foreground">
                    {e.description}
                  </DescriptionText>
                </div>
                <span className="shrink-0 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover/imp:opacity-100">
                  Import
                </span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function DomainsPanel({
  domainId,
  visibility,
  onToggleHidden,
}: {
  domainId: string
  visibility: VisibilityState
  onToggleHidden: (ref: string) => void
}) {
  const { data: bundle } = useBundle(domainId)
  const { data: comments } = useComments(domainId)
  const domains = useMemo(() => (bundle ? externalDomains(bundle) : []), [bundle])
  const referenced = useMemo(() => new Set(domains.map((d) => d.origin)), [domains])

  // Canonical dependencies and resolved references are the import ground truth.
  const taken = useMemo(() => {
    const t = new Set<string>(['kernel.astrale.ai', ...referenced])
    for (const dependency of bundle?.ir?.dependencies ?? []) t.add(dependency.origin)
    for (const descriptor of Object.values(bundle?.ir?.importsByKey ?? {})) {
      t.add(descriptor.origin)
    }
    return t
  }, [referenced, bundle])

  // requested = open import-wish comments whose domain isn't imported yet (ground truth resolves them)
  const requested = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of comments?.comments ?? []) {
      if (c.status !== 'open') continue
      for (const a of c.anchorRefs) {
        if (!a.ref.startsWith(IMPORT_PREFIX)) continue
        const origin = a.ref.slice(IMPORT_PREFIX.length)
        if (referenced.has(origin) || seen.has(origin)) continue
        seen.add(origin)
        out.push(origin)
      }
    }
    return out
  }, [comments, referenced])

  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        <div className="mb-5 flex items-baseline gap-2 pr-8">
          <h1 className="text-base font-semibold">Domains</h1>
          <span className="text-xs text-muted-foreground">{domains.length}</span>
        </div>

        {domains.length > 0 && (
          <>
            <div className="px-1.5 pb-1.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Imported domains
            </div>
            <div className="flex flex-col gap-0.5">
              {domains.map((d) => (
                <DomainRow
                  key={d.origin}
                  domain={d}
                  hidden={isHidden(domainRef(d.origin), visibility.hidden)}
                  onToggleHidden={onToggleHidden}
                />
              ))}
            </div>
          </>
        )}

        {requested.length > 0 && (
          <>
            {domains.length > 0 && <Separator className="my-2 opacity-60" />}
            <div className="px-1.5 pb-1.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Requested
            </div>
            <div className="flex flex-col gap-0.5">
              {requested.map((origin) => (
                <RequestedRow key={origin} domainId={domainId} origin={origin} />
              ))}
            </div>
          </>
        )}

        {domains.length === 0 && requested.length === 0 && (
          <p className="px-2 pb-1 pt-0.5 text-[11px] text-muted-foreground">
            No imported domains yet.
          </p>
        )}

        <Separator className="my-3 opacity-60" />
        <ImportButton domainId={domainId} taken={taken} />
      </div>
    </ScrollArea>
  )
}
