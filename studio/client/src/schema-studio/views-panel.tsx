import { publicationOf } from '@shared/contracts/versions'
import { AppWindow, FileCode2, Globe, Play, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { AnchorButton } from '@/components/anchor'
import { EmptyState, Group, IconTile } from '@/components/studio-kit'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ViewModal } from '@/components/view-modal'
import { cn } from '@/lib/utils'
import { type ViewModel, type ViewsModel, driftLabel, viewAnchor } from '@/lib/views'

function KindIcon({ kind, className }: { kind: ViewModel['kind']; className?: string }) {
  const Icon = kind === 'inline-html' ? FileCode2 : kind === 'spa' ? AppWindow : Globe
  return <Icon className={className} />
}

/**
 * One view row: click to open it live in a modal. A Publication's View is declared by its
 * Schema with no View code behind it: its row names it and opens nothing.
 */
export function ViewRow({ domainId, view }: { domainId: string; view: ViewModel }) {
  const [open, setOpen] = useState(false)
  const drift = driftLabel(view.drift)
  const meta = [view.kind, view.mount].filter(Boolean).join(' · ')
  // the row is a comment/ask target of its own (`view.<slug>`), not the enclosing section
  const anchorRef = viewAnchor(view.slug)
  if (publicationOf(domainId))
    return (
      <div
        data-domain-id={domainId}
        data-anchor-ref={anchorRef}
        data-anchor-excerpt={view.slug}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5"
      >
        <IconTile tone="node" size="sm">
          <AppWindow className="h-3.5 w-3.5" />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-tight">{view.slug}</div>
          <div className="truncate text-[11px] leading-tight text-muted-foreground">
            {view.description ?? 'declared by the published Schema'}
          </div>
        </div>
      </div>
    )
  return (
    <>
      <div
        data-domain-id={domainId}
        data-anchor-ref={anchorRef}
        data-anchor-excerpt={view.slug}
        className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Open live view"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <IconTile tone="node" size="sm">
            <KindIcon kind={view.kind} className="h-3.5 w-3.5" />
          </IconTile>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium leading-tight">{view.slug}</div>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{meta}</div>
          </div>
          {drift && (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 text-[10px] font-medium',
                drift.tone === 'warn' ? 'text-warning' : 'text-muted-foreground',
              )}
            >
              {drift.tone === 'warn' && <TriangleAlert className="h-3 w-3" />}
              {drift.text}
            </span>
          )}
          <Play className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
        </button>
        <AnchorButton
          domainId={domainId}
          anchorRef={{ ref: anchorRef, kind: 'section', file: view.file }}
          excerpt={view.slug}
          className="ml-1"
        />
      </div>
      {open && <ViewModal domainId={domainId} view={view} open={open} onOpenChange={setOpen} />}
    </>
  )
}

/**
 * ViewsPanel - the domain-wide Views overview in the RIGHT PANEL (opened from ⌘K).
 * Every View belongs to the Domain and opens on it; then any orphan client routes. A
 * Publication lists the Views its Schema declares and says its bundle holds no View code.
 */
export function ViewsPanel({ domainId, model }: { domainId: string; model: ViewsModel }) {
  const published = publicationOf(domainId) !== undefined
  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        <div className="mb-5 flex items-baseline gap-2 pr-8">
          <h1 className="text-base font-semibold">Views</h1>
          <span className="text-xs text-muted-foreground">{model.all.length}</span>
          {model.hasDrift && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
              <TriangleAlert className="h-3.5 w-3.5" /> drift
            </span>
          )}
        </div>

        {published && (
          <p className="mb-3 px-2 text-[12px] leading-relaxed text-muted-foreground">
            A published bundle holds no View code: a View opens from its Domain's sources.
          </p>
        )}

        {model.all.length === 0 && (
          <EmptyState
            icon={<AppWindow />}
            title="No views"
            hint={
              published
                ? 'The published Schema declares no views.'
                : 'This domain declares no views.'
            }
          />
        )}

        {model.all.length > 0 && (
          <div className="mb-6 flex flex-col gap-0.5">
            {model.all.map((v) => (
              <ViewRow key={v.slug} domainId={domainId} view={v} />
            ))}
          </div>
        )}

        {model.orphanRoutes.length > 0 && (
          <Group label="Orphan client routes" hint="no declaring view">
            <div className="flex flex-col gap-1">
              {model.orphanRoutes.map((r) => (
                <div
                  key={r}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-warning"
                >
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  <code className="truncate">{r}</code>
                </div>
              ))}
            </div>
          </Group>
        )}
      </div>
    </ScrollArea>
  )
}
