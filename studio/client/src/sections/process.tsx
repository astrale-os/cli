import type { IrMethod, StudioSchemaBundle, ViewInfo } from '@shared/types'

import { ArrowUpRight, Box, Braces, LayoutTemplate, Radio, Sprout, Workflow } from 'lucide-react'
import { useMemo } from 'react'

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
import { methodGlyph } from '@/lib/friendly'
import { useAnatomy, useBundle } from '@/lib/hooks'
import { handlerLinkFor } from '@/lib/method-auth'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

/** A callable = a standalone Function or class Method, enriched with its handler. */
interface Fn {
  owner: string
  ownerKind: 'class' | 'function'
  name: string
  method: IrMethod
  link?: StudioSchemaBundle['overlay']['handlerLinks'][number]
  isSeed: boolean
}

/** postInstall ref looks like `/:origin:class.Workspace:seed` — pull out owner+method. */
function parseSeed(postInstall?: string): { owner: string; method: string } | null {
  if (!postInstall) return null
  const segs = postInstall.split(':')
  const i = segs.findIndex((s) => s.startsWith('class.'))
  if (i === -1 || i + 1 >= segs.length) return null
  const owner = segs[i].slice('class.'.length)
  const method = segs[i + 1]
  return owner && method ? { owner, method } : null
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

  const seed = useMemo(() => parseSeed(bundle?.overlay.postInstall), [bundle?.overlay.postInstall])
  const canonicalV1 = ir?.format === 'astrale.dsl'
  const coreCount = useMemo(() => canonicalCoreCount(ir?.core), [ir?.core])

  // every class method, grouped by its owning class (the "process actor")
  const groups = useMemo(() => {
    if (!ir || !bundle)
      return [] as { owner: string; label: string; className: string | null; fns: Fn[] }[]
    const out: { owner: string; label: string; className: string | null; fns: Fn[] }[] = []

    const domainFunctions = Object.entries(ir.functions ?? {})
    if (domainFunctions.length > 0) {
      out.push({
        owner: ir.domain,
        label: 'Domain functions',
        className: null,
        fns: domainFunctions.map(([name, method]) => ({
          owner: ir.domain,
          ownerKind: 'function',
          name,
          method,
          link: handlerLinkFor(bundle.overlay.handlerLinks, ir.domain, name, 'function'),
          isSeed: false,
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
        isSeed: !!seed && seed.owner === c.name && seed.method === name,
      }))
      out.push({ owner: c.name, label: c.name, className: c.name, fns })
    }
    // float the seed's class to the top — it's the install entrypoint
    return out.sort((a, b) => {
      if (a.owner === seed?.owner) return -1
      if (b.owner === seed?.owner) return 1
      if (a.className === null && b.className !== null) return -1
      if (a.className !== null && b.className === null) return 1
      return 0
    })
  }, [ir, bundle, seed])

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
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <SectionShell
      title="Process"
      subtitle="Entrypoints and the functions they run"
      icon={<Workflow className="h-5 w-5" />}
    >
      {!ir ? (
        <Surface className="px-4 py-3 text-sm text-muted-foreground">
          Schema unavailable — install dependencies to see this domain’s functions.
        </Surface>
      ) : (
        <>
          {/* ── Entrypoints: how a process starts ── */}
          <Group label="Entrypoints">
            <div className="space-y-2">
              {/* Canonical V1 installs portable Core data; legacy projects may expose a seed Method. */}
              {canonicalV1 ? (
                coreCount > 0 ? (
                  <Surface className="flex items-center gap-3 border-emerald-500/30 bg-emerald-500/[0.04] px-4 py-3">
                    <IconTile tone="emerald">
                      <Sprout />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">Core genesis</div>
                      <div className="mt-0.5 text-[13px] text-muted-foreground">
                        {coreCount} portable element{coreCount === 1 ? '' : 's'} installed with the
                        schema
                      </div>
                    </div>
                  </Surface>
                ) : (
                  <Surface className="flex items-center gap-3 px-4 py-3 text-muted-foreground">
                    <IconTile tone="muted">
                      <Sprout />
                    </IconTile>
                    <div className="min-w-0 flex-1 text-[13px]">
                      No Core genesis data declared in this schema.
                    </div>
                  </Surface>
                )
              ) : seed ? (
                <Surface
                  onClick={() => gotoClass(seed.owner)}
                  className="flex cursor-pointer items-center gap-3 border-emerald-500/30 bg-emerald-500/[0.04] px-4 py-3 transition-colors hover:bg-emerald-500/[0.08]"
                >
                  <IconTile tone="emerald">
                    <Sprout />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {seed.owner}.{seed.method}
                    </div>
                    <div className="mt-0.5 text-[13px] text-muted-foreground">
                      Seed — runs once on install
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Surface>
              ) : (
                <Surface className="flex items-center gap-3 px-4 py-3 text-muted-foreground">
                  <IconTile tone="muted">
                    <Sprout />
                  </IconTile>
                  <div className="min-w-0 flex-1 text-[13px]">
                    This legacy domain has no post-install seed Method.
                  </div>
                </Surface>
              )}

              {/* views — UI entrypoints */}
              {views.length > 0 && (
                <Surface
                  onClick={gotoViews}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                >
                  <IconTile tone="sky">
                    <LayoutTemplate />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">
                      {views.length} view{views.length === 1 ? '' : 's'}{' '}
                      <span className="font-normal text-muted-foreground">· UI entrypoints</span>
                    </div>
                    {uiTargets.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {uiTargets.slice(0, 8).map((t) => (
                          <Chip key={t} tone="outline">
                            {t}
                          </Chip>
                        ))}
                        {uiTargets.length > 8 && (
                          <Chip tone="default">+{uiTargets.length - 8}</Chip>
                        )}
                      </div>
                    )}
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Surface>
              )}

              {/* triggers — not parsed yet (defined in the services domain) */}
              <Surface className="flex items-center gap-3 border-dashed px-4 py-3 text-muted-foreground">
                <IconTile tone="muted">
                  <Radio />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-muted-foreground">Triggers</div>
                  <div className="mt-0.5 text-[13px] text-muted-foreground/70">
                    On event · polling · cron — wired via the services domain. Not parsed yet.
                  </div>
                </div>
              </Surface>
            </div>
          </Group>

          {/* ── Functions, grouped by the class they run on ── */}
          {fnCount === 0 ? (
            <EmptyState
              icon={<Workflow />}
              title="No functions yet"
              hint="Add a standalone Function or class Method to the schema to see it here."
            />
          ) : (
            <Group label="Functions" hint={`${fnCount}`}>
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
                        {g.fns.length} fn
                      </span>
                    </button>
                    <div className="border-t">
                      {g.fns.map((fn) => (
                        <FnRow
                          key={fn.name}
                          fn={fn}
                          onClick={fn.ownerKind === 'class' ? () => gotoClass(fn.owner) : undefined}
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
  )
}

function FnRow({ fn, onClick }: { fn: Fn; onClick?: () => void }) {
  const glyph = methodGlyph(fn.method)
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
          <MethodAuthBadge method={fn.method} link={fn.link} interactive={!onClick} />
          {fn.ownerKind === 'function' && <Chip tone="primary">function</Chip>}
          {fn.isSeed && <Chip tone="success">seed</Chip>}
          {fn.method.static && <Chip tone="default">static</Chip>}
          {fn.method.inheritance === 'abstract' && <Chip tone="fuchsia">contract</Chip>}
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
