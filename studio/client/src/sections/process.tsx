import type { IrFunction, IrMethod, StudioSchemaBundle, ViewInfo } from '@shared/types'

import { ArrowUpRight, Box, Braces, LayoutTemplate, Sprout, Workflow, Zap } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'

import { MethodAuthBadge } from '@/components/method-auth'
import {
  Chip,
  EmptyState,
  Group,
  IconTile,
  Row,
  SectionShell,
  Surface,
} from '@/components/studio-kit'
import { ScrollArea } from '@/components/ui/misc'
import { methodGlyph } from '@/lib/friendly'
import { useAnatomy, useBundle } from '@/lib/hooks'
import { handlerLinkFor } from '@/lib/method-auth'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import { DomainPicker, DomainsRailHeader } from '@/schema-studio/domains-rail'
import { ModulesSidebar } from '@/schema-studio/sidebar'

/** One callable contract enriched with its Action or Workflow implementation. */
interface Fn {
  owner: string
  ownerKind: 'class' | 'function'
  name: string
  method: IrMethod | IrFunction
  link?: StudioSchemaBundle['overlay']['handlerLinks'][number]
}

/** Count the portable genesis elements in a canonical DomainSchema V1 Core. */
export function canonicalCoreCount(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  const core = value as { nodes?: unknown; edges?: unknown }
  const nodes =
    core.nodes && typeof core.nodes === 'object' && !Array.isArray(core.nodes)
      ? Object.keys(core.nodes).length
      : 0
  return nodes + (Array.isArray(core.edges) ? core.edges.length : 0)
}

/** Distinct classes a list of views binds to (UI entrypoints), in first-seen order. */
function viewTargets(views: ViewInfo[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of views) {
    for (const t of Array.isArray(v.viewFor) ? v.viewFor : v.viewFor ? [v.viewFor] : []) {
      if (!seen.has(t)) {
        seen.add(t)
        out.push(t)
      }
    }
  }
  return out
}

export function ProcessSection({ domainId }: { domainId: string }) {
  const bundleQ = useBundle(domainId)
  const anatomyQ = useAnatomy(domainId)
  const setSection = useUI((s) => s.setSection)
  const focusClass = useUI((s) => s.focusClass)
  const setPanelOverlay = useUI((s) => s.setPanelOverlay)

  const bundle = bundleQ.data
  const anatomy = anatomyQ.data
  const ir = bundle?.ir ?? null

  const coreCount = useMemo(() => canonicalCoreCount(ir?.core), [ir?.core])

  // every class method, grouped by its owning class (the "process actor")
  const groups = useMemo(() => {
    if (!ir || !bundle)
      return [] as { owner: string; label: string; className: string | null; fns: Fn[] }[]
    const out: { owner: string; label: string; className: string | null; fns: Fn[] }[] = []

    const domainFunctions = Object.entries(ir.functions)
    if (domainFunctions.length > 0) {
      out.push({
        owner: ir.domain,
        label: 'Domain callables',
        className: null,
        fns: domainFunctions.map(([name, method]) => ({
          owner: ir.domain,
          ownerKind: 'function',
          name,
          method,
          link: handlerLinkFor(bundle.overlay.handlerLinks, ir.domain, name, 'function'),
        })),
      })
    }

    for (const c of Object.values(ir.classes)) {
      const entries = Object.entries(c.methods ?? {})
      if (entries.length === 0) continue
      const fns: Fn[] = entries.map(([name, method]) => ({
        owner: c.name,
        ownerKind: 'class',
        name,
        method,
        link: handlerLinkFor(bundle.overlay.handlerLinks, c.name, name, 'class'),
      }))
      out.push({ owner: c.name, label: c.name, className: c.name, fns })
    }
    return out.sort((a, b) => {
      if (a.className === null && b.className !== null) return -1
      if (a.className !== null && b.className === null) return 1
      return 0
    })
  }, [ir, bundle])

  const fnCount = groups.reduce((n, g) => n + g.fns.length, 0)
  const views = anatomy?.views ?? []
  const uiTargets = useMemo(() => viewTargets(views), [views])

  const gotoClass = (name: string) => {
    setSection('schema')
    focusClass(`class.${name}`)
  }
  const gotoViews = () => {
    setSection('schema')
    setPanelOverlay('views')
  }

  if (bundleQ.isLoading || anatomyQ.isLoading) {
    return (
      <ProcessLayout>
        <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
          Loading…
        </div>
      </ProcessLayout>
    )
  }

  return (
    <ProcessLayout>
      <SectionShell
        title="Process"
        subtitle="Actions and workflows implementing callable contracts"
        icon={<Workflow className="h-5 w-5" />}
      >
        {!ir ? (
          <Surface className="px-4 py-3 text-sm text-muted-foreground">
            Schema unavailable — install dependencies to see this domain’s callable contracts.
          </Surface>
        ) : (
          <>
            {/* ── Entrypoints: how a process starts ── */}
            <Group label="Entrypoints">
              <Surface className="divide-y">
                <Row
                  leading={
                    <IconTile tone={coreCount > 0 ? 'core' : 'muted'}>
                      <Sprout />
                    </IconTile>
                  }
                  title="Core genesis"
                  subtitle={
                    coreCount > 0
                      ? `${coreCount} element${coreCount === 1 ? '' : 's'} installed with the schema`
                      : 'None declared'
                  }
                />
                {views.length > 0 && (
                  <Row
                    onClick={gotoViews}
                    leading={
                      <IconTile tone="view">
                        <LayoutTemplate />
                      </IconTile>
                    }
                    title={`${views.length} view${views.length === 1 ? '' : 's'}`}
                    subtitle={uiTargets.length > 0 ? uiTargets.join(' · ') : 'UI entrypoints'}
                    trailing={<ArrowUpRight className="h-4 w-4 text-muted-foreground" />}
                  />
                )}
              </Surface>
            </Group>

            {/* ── Functions, grouped by the class they run on ── */}
            {fnCount === 0 ? (
              <EmptyState
                icon={<Workflow />}
                title="No callable contracts yet"
                hint="Add a standalone Function or class Method to the schema to see it here."
              />
            ) : (
              <Group label="Runtime" hint={`${fnCount}`}>
                <div className="space-y-3">
                  {groups.map((g) => (
                    <Surface key={g.owner} className="overflow-hidden">
                      <button
                        type="button"
                        onClick={g.className ? () => gotoClass(g.className!) : undefined}
                        className={cn(
                          'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                          g.className && 'hover:bg-accent/40',
                        )}
                      >
                        <IconTile tone="muted" size="sm">
                          {g.className ? <Box /> : <Braces />}
                        </IconTile>
                        <span className="flex-1 truncate text-[13px] font-semibold">{g.label}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {g.fns.length} callable
                        </span>
                      </button>
                      <div className="border-t">
                        {g.fns.map((fn) => (
                          <FnRow
                            key={fn.name}
                            fn={fn}
                            onClick={
                              fn.ownerKind === 'class' ? () => gotoClass(fn.owner) : undefined
                            }
                          />
                        ))}
                      </div>
                    </Surface>
                  ))}
                </div>
              </Group>
            )}
          </>
        )}
      </SectionShell>
    </ProcessLayout>
  )
}

/**
 * Process reads one domain at a time and draws no canvas, but it is still a place you
 * work FROM — so it carries the same domains rail as the schema studio, or switching
 * domains would mean leaving the section first.
 */
function ProcessLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <ModulesSidebar header={<DomainsRailHeader />}>
        <ScrollArea className="h-full">
          <DomainPicker />
        </ScrollArea>
      </ModulesSidebar>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  )
}

function FnRow({ fn, onClick }: { fn: Fn; onClick?: () => void }) {
  const glyph =
    fn.link?.kind === 'workflow'
      ? { icon: Workflow, tone: 'fuchsia' }
      : fn.link?.kind === 'action'
        ? { icon: Zap, tone: 'violet' }
        : 'inheritance' in fn.method
          ? methodGlyph(fn.method)
          : { icon: Zap, tone: 'violet' }
  const Glyph = glyph.icon
  const calls = fn.link?.kernelCalls ?? []
  const contractOnly = fn.link && !fn.link.implemented
  return (
    <Row
      onClick={onClick}
      className="px-3 py-2 border-t first:border-t-0 rounded-none"
      leading={
        <IconTile tone={glyph.tone} size="sm">
          <Glyph />
        </IconTile>
      }
      title={
        <span className="flex items-center gap-1.5">
          <span className="font-semibold">{fn.name}</span>
          <MethodAuthBadge method={fn.method} interactive={!onClick} />
          {fn.link && <Chip tone="primary">{fn.link.kind}</Chip>}
          {'static' in fn.method && fn.method.static && <Chip tone="default">static</Chip>}
          {'inheritance' in fn.method && fn.method.inheritance === 'abstract' && (
            <Chip tone="fn">contract</Chip>
          )}
          {contractOnly && <Chip tone="warning">needs handler</Chip>}
          {fn.link?.unlinked && <Chip tone="default">unlinked</Chip>}
        </span>
      }
      trailing={
        calls.length > 0 ? (
          <div className="hidden items-center gap-1 sm:flex">
            {calls.slice(0, 3).map((k) => (
              <Chip key={k} tone="outline" className="font-mono">
                {k}
              </Chip>
            ))}
            {calls.length > 3 && <Chip tone="default">+{calls.length - 3}</Chip>}
          </div>
        ) : undefined
      }
    />
  )
}
