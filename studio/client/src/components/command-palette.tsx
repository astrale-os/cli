import type { DomainIntrospectionTiming } from '@shared/contracts/runtime'
import type { StudioSchemaBundle } from '@shared/contracts/schema'
import type { DomainSummary } from '@shared/contracts/workspace'

import { publicationOf } from '@shared/contracts/versions'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Command } from 'cmdk'
import {
  AppWindow,
  ArrowRight,
  Box,
  Braces,
  Database,
  Folder,
  Globe,
  Loader2,
  Map as MapIcon,
  Spline,
  Tag,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { TOUR_STEPS } from '@/components/tour'
import { api, qk } from '@/lib/api'
import { bundleQueryOptions } from '@/lib/domain-queries'
import { buildFunctionsModel } from '@/lib/functions'
import { useWorkspace } from '@/lib/hooks'
import { introspectionPhaseLabel } from '@/lib/introspection'
import { shownDomainId, useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import { folderModules, moduleOfClass } from '@/schema-studio/modules'
import { LENS_NAMES } from '@/studio/lenses/keys'

/** The domain-level overviews. They open in the schema section's right panel —
 *  reachable from here rather than from a permanent row of canvas buttons. */
const OVERVIEWS: { key: 'domains' | 'views'; label: string; icon: typeof Box }[] = [
  { key: 'domains', label: 'Imported domains', icon: Globe },
  { key: 'views', label: 'Views', icon: AppWindow },
]

/** Summarise a JSON Schema property type for the muted meta column. */
function propTypeLabel(
  schema:
    | { type?: string | string[]; enum?: unknown[]; items?: { type?: string | string[] } }
    | undefined,
  optionalOverride?: boolean,
): string {
  if (!schema) return 'unknown'
  if (Array.isArray(schema.enum) && schema.enum.length) return optionalOverride ? 'enum?' : 'enum'
  const t = schema.type
  if (Array.isArray(t)) {
    const base = t.filter((x) => x !== 'null')
    const optional = optionalOverride ?? t.includes('null')
    const name = base.length === 1 ? base[0] : base.join(' | ') || 'unknown'
    return optional ? `${name}?` : name
  }
  const label =
    t === 'array' ? `${schema.items?.type ?? 'unknown'}[]` : ((t as string) ?? 'unknown')
  return optionalOverride ? `${label}?` : label
}

/** Row icon + label + muted meta — the shared visual for every item. */
function Row({
  icon: Icon,
  label,
  meta,
}: {
  icon: typeof Box
  label: React.ReactNode
  meta?: string
}) {
  return (
    <>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{label}</span>
      {meta ? (
        <span className="ml-2 shrink-0 truncate text-xs text-muted-foreground">{meta}</span>
      ) : null}
    </>
  )
}

const ITEM_CLS =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'

/** A Domain ⌘K searches, by what names it: its origin, and a Publication's version with it. */
export interface PaletteDomain {
  id: string
  label: string
}

/**
 * The Domains ⌘K searches: the Workspace's, and first the Publication in view when one is. A
 * Publication is no Domain of the Workspace, but it is the one the page reads.
 */
export function paletteDomains(
  workspace: readonly DomainSummary[],
  shownId: string | undefined,
): PaletteDomain[] {
  const publication = shownId === undefined ? undefined : publicationOf(shownId)
  return [
    ...(publication && shownId
      ? [{ id: shownId, label: `${publication.origin} ${publication.version}` }]
      : []),
    ...workspace.map((domain) => ({ id: domain.id, label: domain.origin })),
  ]
}

/** What every searchable item carries: its domain, the text cmdk matches, and the meta column. */
interface IndexEntry {
  domainId: string
  domainLabel: string
  value: string
  meta: string
}

interface NamedEntry extends IndexEntry {
  name: string
}

interface SearchIndex {
  classes: NamedEntry[]
  edges: NamedEntry[]
  functions: NamedEntry[]
  properties: Array<IndexEntry & { id: string; owner: string; prop: string }>
  modules: Array<IndexEntry & { path: string; firstClass?: string }>
}

interface CachedDomainIndex {
  revision: string
  value: SearchIndex
}

const emptySearchIndex = (): SearchIndex => ({
  classes: [],
  edges: [],
  functions: [],
  properties: [],
  modules: [],
})

const byValue = <T extends IndexEntry>(entries: T[]): T[] =>
  entries.sort((a, b) => a.value.localeCompare(b.value))

/**
 * Keep schema indexing tied to schema revisions, not component renders.
 *
 * The live phase indicator refreshes every 500 ms while bundles are pending. It
 * renders this component too, but it must not rebuild and re-sort every loaded
 * Domain's search entries. A Domain is indexed once per render fingerprint; the
 * combined index only changes when the workspace or one of those fingerprints does.
 */
export class PaletteSearchIndexCache {
  private readonly domains = new Map<string, CachedDomainIndex>()
  private revision?: string
  private value = emptySearchIndex()

  build(domains: PaletteDomain[], bundles: Array<StudioSchemaBundle | undefined>): SearchIndex {
    const revision = JSON.stringify(
      domains.map((domain, index) => [
        domain.id,
        domain.label,
        bundles[index]?.renderFingerprint ?? null,
      ]),
    )
    if (revision === this.revision) {
      return this.value
    }

    const active = new Set(domains.map(({ id }) => id))
    for (const domainId of this.domains.keys()) {
      if (!active.has(domainId)) this.domains.delete(domainId)
    }

    const indexes = domains.map((domain, index) => {
      const bundle = bundles[index]
      if (!bundle) return emptySearchIndex()
      const domainRevision = `${domain.label}\0${bundle.renderFingerprint}`
      const cached = this.domains.get(domain.id)
      if (cached?.revision === domainRevision) return cached.value
      const value = buildDomainIndex(domain, bundle)
      this.domains.set(domain.id, { revision: domainRevision, value })
      return value
    })
    this.value = {
      classes: byValue(indexes.flatMap((entry) => entry.classes)),
      edges: byValue(indexes.flatMap((entry) => entry.edges)),
      functions: byValue(indexes.flatMap((entry) => entry.functions)),
      properties: byValue(indexes.flatMap((entry) => entry.properties)),
      modules: byValue(indexes.flatMap((entry) => entry.modules)),
    }
    this.revision = revision
    return this.value
  }
}

type BundleQueryState = { data?: StudioSchemaBundle; isError: boolean }

/** A Domain's bundle as every reader holds it, read at background priority for the index. */
const paletteBundleQuery = (domainId: string, open: boolean) => ({
  ...bundleQueryOptions(domainId),
  queryFn: () => api.bundle(domainId, 'background'),
  enabled: open,
})

function paletteLoadState(domains: PaletteDomain[], results: BundleQueryState[]) {
  const loaded: PaletteDomain[] = []
  const pending: PaletteDomain[] = []
  const failed: PaletteDomain[] = []
  domains.forEach((domain, index) => {
    const result = results[index]
    if (result?.data !== undefined) loaded.push(domain)
    else if (result?.isError) failed.push(domain)
    else pending.push(domain)
  })
  return { loaded, pending, failed }
}

function loadingDetail(
  domains: PaletteDomain[],
  timings: DomainIntrospectionTiming[] | undefined,
): string {
  const byDomain = new Map(timings?.map((timing) => [timing.domainId, timing]))
  const shown = domains.slice(0, 3).map((domain) => {
    const timing = byDomain.get(domain.id)
    return `${domain.label} — ${introspectionPhaseLabel(timing)}`
  })
  const remaining = domains.length - shown.length
  return `${shown.join(' · ')}${remaining > 0 ? ` · +${remaining} more` : ''}`
}

function buildDomainIndex(domain: PaletteDomain, bundle?: StudioSchemaBundle): SearchIndex {
  const ir = bundle?.ir
  if (!ir || !bundle) return emptySearchIndex()
  const base = { domainId: domain.id, domainLabel: domain.label }

  const classes = Object.values(ir.classes)
    .filter((candidate) => candidate.type === 'node')
    .map((candidate) => {
      const propCount = Object.keys(candidate.properties).length
      const methodCount = Object.keys(candidate.methods).length
      const module = moduleOfClass(bundle, candidate.name)
      const counts = [
        propCount > 0 ? `${propCount} propert${propCount === 1 ? 'y' : 'ies'}` : '',
        methodCount > 0 ? `${methodCount} method${methodCount === 1 ? '' : 's'}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
      return {
        ...base,
        name: candidate.name,
        value: `${domain.label} class ${candidate.name} ${module} ${counts}`,
        meta: [domain.label, module === 'root' ? '' : module, counts].filter(Boolean).join(' · '),
      }
    })

  const edges = Object.values(ir.classes)
    .filter((candidate) => candidate.type === 'edge')
    .map((edge) => {
      const [source, target] = edge.endpoints ?? []
      const sourceType = source?.types.join('|') ?? '?'
      const targetType = target?.types.join('|') ?? '?'
      return {
        ...base,
        name: edge.name,
        value: `${domain.label} edge ${edge.name} ${sourceType} ${targetType} relationship`,
        meta: `${domain.label} · ${sourceType} → ${targetType}`,
      }
    })

  // A standalone Function is a schema member like any other: findable by its own name,
  // not only through the domain's Functions overview.
  const functions = buildFunctionsModel(bundle).all.map((fn) => {
    const worksOn = fn.boundClasses.join(' ')
    const kind = fn.link?.kind ?? 'contract'
    return {
      ...base,
      name: fn.name,
      value: `${domain.label} function ${fn.name} ${kind} ${worksOn}`,
      meta: [domain.label, kind, worksOn].filter(Boolean).join(' · '),
    }
  })

  const properties: SearchIndex['properties'] = []
  for (const candidate of Object.values(ir.classes)) {
    if (candidate.type !== 'node') continue
    for (const [property, schema] of Object.entries(candidate.properties)) {
      const optional = candidate.required ? !candidate.required.includes(property) : undefined
      const type = propTypeLabel(schema, optional)
      properties.push({
        ...base,
        id: `class.${candidate.name}.property.${property}`,
        owner: candidate.name,
        prop: property,
        value: `${domain.label} ${candidate.name}.${property} property ${type}`,
        meta: `${domain.label} · ${type}`,
      })
    }
  }

  const modules = folderModules(bundle).map((module) => {
    const count = module.classes.length + module.edges.length
    return {
      ...base,
      path: module.path,
      firstClass: module.classes[0],
      value: `${domain.label} module ${module.path} ${module.classes.join(' ')} ${module.edges.join(' ')}`,
      meta: `${domain.label} · ${count} member${count === 1 ? '' : 's'}`,
    }
  })

  return { classes, edges, functions, properties, modules }
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen)
  const setPaletteOpen = useUI((s) => s.setPaletteOpen)
  const openDataLevel = useUI((s) => s.openDataLevel)
  const setLens = useUI((s) => s.setLens)
  const setTourOpen = useUI((s) => s.setTourOpen)
  const selectClass = useUI((s) => s.selectClass)
  const focusClass = useUI((s) => s.focusClass)
  const setFocus = useUI((s) => s.setFocus)
  const revealOnCanvas = useUI((s) => s.revealOnCanvas)
  const setPanelOverlay = useUI((s) => s.setPanelOverlay)
  const openDomain = useUI((s) => s.openDomain)
  const level = useUI((s) => s.level)
  const readerDomainId = useUI((s) => s.readerDomainId)
  const selectionDomainId = useUI((s) => s.selectionDomainId)
  const { data: workspace = [] } = useWorkspace()
  const shownId =
    level === 'workspace'
      ? undefined
      : shownDomainId({ readerDomainId, selectionDomainId }, workspace)
  const domains = useMemo(() => paletteDomains(workspace, shownId), [workspace, shownId])
  const indexCache = useRef<PaletteSearchIndexCache | null>(null)
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (!open) setSearch('')
  }, [open])
  if (!indexCache.current) indexCache.current = new PaletteSearchIndexCache()
  const bundleQueries = useQueries({
    queries: domains.map((domain) => paletteBundleQuery(domain.id, open)),
  })
  const load = paletteLoadState(domains, bundleQueries)
  const bundles = bundleQueries.map((result) => result.data)
  const { data: introspection } = useQuery({
    queryKey: qk.introspection,
    queryFn: api.introspection,
    enabled: open && load.pending.length > 0,
    staleTime: 0,
    refetchInterval: open && load.pending.length > 0 ? 500 : false,
  })

  // Global Cmd/Ctrl+K toggles the palette. (cmdk's Dialog handles Esc to close.)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setPaletteOpen(!useUI.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen])

  const close = () => setPaletteOpen(false)

  // cmdk ranks items, not groups: the tour sits last, and comes first only when asked for.
  const wantsHelp = /\b(tour|onboard|help|guide)/i.test(search)
  const helpGroup = (
    <Command.Group heading="Help">
      <Command.Item
        value="tour studio onboarding help"
        className={ITEM_CLS}
        onSelect={() => {
          close()
          setTourOpen(true)
        }}
      >
        <Row icon={MapIcon} label="Studio tour" meta={`${TOUR_STEPS.length} steps`} />
      </Command.Item>
    </Command.Group>
  )

  // Build once per Domain schema revision, not once per loading-phase poll.
  const index = indexCache.current.build(domains, bundles)

  const pendingDetail =
    load.pending.length > 0 ? loadingDetail(load.pending, introspection?.domains) : ''

  /** Every schema result lands the same way: on the Schema of its own Domain. */
  const openInSchema = (domainId: string, then?: () => void) => {
    openDomain(domainId)
    then?.()
    close()
  }
  const focusOnCanvas = (ref: string, domainId: string) => {
    focusClass(ref, domainId)
    revealOnCanvas(ref)
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setPaletteOpen}
      label="Command palette"
      shouldFilter
      // The Radix overlay that cmdk renders.
      overlayClassName="fixed inset-0 z-50 bg-foreground/20"
      contentClassName={cn(
        'fixed left-1/2 top-[15%] z-50 w-full max-w-[640px] -translate-x-1/2',
        'overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl',
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
        '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
        '[&_[cmdk-group-heading]]:text-muted-foreground',
      )}
    >
      <div className="flex items-center border-b px-3">
        <Command.Input
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder="Search the schema…"
          className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {load.pending.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        >
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              Preparing search index · {load.loaded.length}/{domains.length} domains
            </p>
            <p className="mt-0.5 truncate" title={pendingDetail}>
              {pendingDetail}
            </p>
          </div>
        </div>
      )}

      {load.pending.length === 0 && load.failed.length > 0 && (
        <div role="status" className="border-b bg-warning/10 px-3 py-2 text-xs text-warning">
          Search index incomplete · {load.failed.map((domain) => domain.label).join(', ')} failed
        </div>
      )}

      <Command.List className="max-h-[60vh] overflow-y-auto overflow-x-hidden p-2">
        {wantsHelp && helpGroup}

        <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
          {load.pending.length > 0 ? 'No matches in the domains loaded so far' : 'No results'}
        </Command.Empty>

        {index.classes.length > 0 && (
          <Command.Group heading="Classes">
            {index.classes.map((c) => (
              <Command.Item
                key={`${c.domainId}:class.${c.name}`}
                value={c.value}
                className={ITEM_CLS}
                onSelect={() =>
                  openInSchema(c.domainId, () => focusOnCanvas(`class.${c.name}`, c.domainId))
                }
              >
                <Row icon={Box} label={c.name} meta={c.meta} />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {index.functions.length > 0 && (
          <Command.Group heading="Functions">
            {index.functions.map((f) => (
              <Command.Item
                key={`${f.domainId}:function.${f.name}`}
                value={f.value}
                className={ITEM_CLS}
                onSelect={() =>
                  openInSchema(f.domainId, () => focusOnCanvas(`function.${f.name}`, f.domainId))
                }
              >
                <Row icon={Braces} label={f.name} meta={f.meta} />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {index.edges.length > 0 && (
          <Command.Group heading="Relationships">
            {index.edges.map((e) => (
              <Command.Item
                key={`${e.domainId}:edge.${e.name}`}
                value={e.value}
                className={ITEM_CLS}
                onSelect={() =>
                  openInSchema(e.domainId, () => {
                    // A relationship selects under `class.` like everything else on the canvas,
                    // but it is a LINE: what the canvas brings into view is the pair of cards it
                    // runs between, which only the `edge.` ref asks for.
                    selectClass(`class.${e.name}`, e.domainId)
                    setFocus(null)
                    revealOnCanvas(`edge.${e.name}`)
                  })
                }
              >
                <Row
                  icon={Spline}
                  label={
                    <>
                      {e.name} <span className="text-xs text-muted-foreground">({e.meta})</span>
                    </>
                  }
                />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {index.properties.length > 0 && (
          <Command.Group heading="Properties">
            {index.properties.map((p) => (
              <Command.Item
                key={`${p.domainId}:${p.id}`}
                value={p.value}
                className={ITEM_CLS}
                onSelect={() =>
                  openInSchema(p.domainId, () => focusOnCanvas(`class.${p.owner}`, p.domainId))
                }
              >
                <Row
                  icon={Tag}
                  label={
                    <>
                      <span className="text-muted-foreground">{p.owner}.</span>
                      {p.prop}
                    </>
                  }
                  meta={p.meta}
                />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {index.modules.length > 0 && (
          <Command.Group heading="Modules">
            {index.modules.map((m) => (
              <Command.Item
                key={`${m.domainId}:module.${m.path}`}
                value={m.value}
                className={ITEM_CLS}
                onSelect={() =>
                  openInSchema(m.domainId, () => {
                    if (m.firstClass) focusOnCanvas(`class.${m.firstClass}`, m.domainId)
                  })
                }
              >
                <Row icon={Folder} label={m.path} meta={m.meta} />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Overviews">
          {domains.flatMap((domain) =>
            OVERVIEWS.map((o) => (
              <Command.Item
                key={`${domain.id}:overview.${o.key}`}
                value={`open ${domain.label} ${o.label} ${o.key} overview`}
                className={ITEM_CLS}
                onSelect={() => openInSchema(domain.id, () => setPanelOverlay(o.key, domain.id))}
              >
                <Row icon={o.icon} label={o.label} meta={domain.label} />
              </Command.Item>
            )),
          )}
        </Command.Group>

        <Command.Group heading="Go to">
          {LENS_NAMES.filter((lens) => lens.available).map((lens) => (
            <Command.Item
              key={`lens.${lens.id}`}
              value={`go to ${lens.label} lens ${lens.question}`}
              className={ITEM_CLS}
              onSelect={() => {
                setLens(lens.id)
                close()
              }}
            >
              <Row icon={ArrowRight} label={lens.label} meta={`lens · ${lens.shortcut}`} />
            </Command.Item>
          ))}
          <Command.Item
            value="go to data datasets dataset level who may policies"
            className={ITEM_CLS}
            onSelect={() => {
              openDataLevel(null)
              close()
            }}
          >
            <Row icon={Database} label="Datasets" meta="the Domain's datasets, each to open" />
          </Command.Item>
        </Command.Group>

        {!wantsHelp && helpGroup}
      </Command.List>

      <div className="flex items-center justify-end gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span>↑↓ navigate</span>
        <span>·</span>
        <span>↵ select</span>
        <span>·</span>
        <span>esc close</span>
      </div>
    </Command.Dialog>
  )
}
