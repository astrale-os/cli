import type { DomainSummary, StudioSchemaBundle } from '@shared/types'

import { useQueries } from '@tanstack/react-query'
import { Command } from 'cmdk'
import { AppWindow, ArrowRight, Box, Folder, Globe, Plug, Spline, Tag } from 'lucide-react'
import { useEffect, useMemo } from 'react'

import { api, qk } from '@/lib/api'
import { useWorkspace } from '@/lib/hooks'
import { type SectionKey, useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import { folderModules, moduleOfClass } from '@/schema-studio/modules'
import { useCanvasDomains } from '@/schema-studio/workspace/canvas-selection'

/** The nav sections, mirroring app.tsx's NAV order/labels. */
const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'schema', label: 'Schema' },
  { key: 'core', label: 'Core' },
  { key: 'tests', label: 'Tests' },
  { key: 'process', label: 'Process' },
]

/** The domain-level overviews. They open in the schema section's right panel —
 *  reachable from here rather than from a permanent row of canvas buttons. */
const OVERVIEWS: { key: 'domains' | 'views' | 'integrations'; label: string; icon: typeof Box }[] =
  [
    { key: 'domains', label: 'Imported domains', icon: Globe },
    { key: 'views', label: 'Views', icon: AppWindow },
    { key: 'integrations', label: 'Integrations', icon: Plug },
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

interface SearchIndex {
  classes: Array<{
    domainId: string
    domainLabel: string
    name: string
    value: string
    meta: string
  }>
  edges: Array<{ domainId: string; domainLabel: string; name: string; value: string; meta: string }>
  properties: Array<{
    domainId: string
    domainLabel: string
    id: string
    owner: string
    prop: string
    value: string
    meta: string
  }>
  modules: Array<{
    domainId: string
    domainLabel: string
    path: string
    firstClass?: string
    value: string
    meta: string
  }>
}

function buildDomainIndex(domain: DomainSummary, bundle?: StudioSchemaBundle): SearchIndex {
  const ir = bundle?.ir
  if (!ir || !bundle) return { classes: [], edges: [], properties: [], modules: [] }
  const base = { domainId: domain.id, domainLabel: domain.origin }

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
        value: `${domain.origin} class ${candidate.name} ${module} ${counts}`,
        meta: [domain.origin, module === 'root' ? '' : module, counts].filter(Boolean).join(' · '),
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
        value: `${domain.origin} edge ${edge.name} ${sourceType} ${targetType} relationship`,
        meta: `${domain.origin} · ${sourceType} → ${targetType}`,
      }
    })

  const properties: SearchIndex['properties'] = []
  for (const candidate of Object.values(ir.classes)) {
    if (candidate.type !== 'node') continue
    for (const [property, schema] of Object.entries(candidate.properties)) {
      const optional = candidate.required ? !candidate.required.includes(property) : undefined
      properties.push({
        ...base,
        id: `class.${candidate.name}.property.${property}`,
        owner: candidate.name,
        prop: property,
        value: `${domain.origin} ${candidate.name}.${property} property ${propTypeLabel(schema, optional)}`,
        meta: `${domain.origin} · ${propTypeLabel(schema, optional)}`,
      })
    }
  }

  const modules = folderModules(bundle).map((module) => {
    const count = module.classes.length + module.edges.length
    return {
      ...base,
      path: module.path,
      firstClass: module.classes[0],
      value: `${domain.origin} module ${module.path} ${module.classes.join(' ')} ${module.edges.join(' ')}`,
      meta: `${domain.origin} · ${count} member${count === 1 ? '' : 's'}`,
    }
  })

  return { classes, edges, properties, modules }
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen)
  const setPaletteOpen = useUI((s) => s.setPaletteOpen)
  const setSection = useUI((s) => s.setSection)
  const selectClass = useUI((s) => s.selectClass)
  const focusClass = useUI((s) => s.focusClass)
  const setFocus = useUI((s) => s.setFocus)
  const revealOnCanvas = useUI((s) => s.revealOnCanvas)
  const setPanelOverlay = useUI((s) => s.setPanelOverlay)
  const canvas = useCanvasDomains()
  const { data: domains = [] } = useWorkspace()
  const bundles = useQueries({
    queries: domains.map((domain) => ({
      queryKey: qk.bundle(domain.id),
      queryFn: () => api.bundle(domain.id),
    })),
    combine: (results) => results.map((result) => result.data),
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

  // Build one searchable index over every domain in the scanned workspace.
  const index = useMemo(() => {
    const indexes = domains.map((domain, position) => buildDomainIndex(domain, bundles[position]))
    return {
      classes: indexes
        .flatMap((entry) => entry.classes)
        .sort((a, b) => a.value.localeCompare(b.value)),
      edges: indexes.flatMap((entry) => entry.edges).sort((a, b) => a.value.localeCompare(b.value)),
      properties: indexes
        .flatMap((entry) => entry.properties)
        .sort((a, b) => a.value.localeCompare(b.value)),
      modules: indexes
        .flatMap((entry) => entry.modules)
        .sort((a, b) => a.value.localeCompare(b.value)),
    }
  }, [bundles, domains])

  const showDomain = (domainId: string) => {
    if (!canvas.visible.has(domainId)) canvas.toggleOnCanvas(domainId)
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
          placeholder="Search the schema…"
          className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <Command.List className="max-h-[60vh] overflow-y-auto overflow-x-hidden p-2">
        <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
          No results
        </Command.Empty>

        {index.classes.length > 0 && (
          <Command.Group heading="Classes">
            {index.classes.map((c) => (
              <Command.Item
                key={`${c.domainId}:class.${c.name}`}
                value={c.value}
                className={ITEM_CLS}
                onSelect={() => {
                  setSection('schema')
                  showDomain(c.domainId)
                  focusClass(`class.${c.name}`, c.domainId)
                  revealOnCanvas(`class.${c.name}`)
                  close()
                }}
              >
                <Row icon={Box} label={c.name} meta={c.meta} />
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
                onSelect={() => {
                  setSection('schema')
                  showDomain(e.domainId)
                  // A relationship selects under `class.` like everything else on the canvas,
                  // but it is a LINE: what the canvas brings into view is the pair of cards it
                  // runs between, which only the `edge.` ref asks for.
                  selectClass(`class.${e.name}`, e.domainId)
                  setFocus(null)
                  revealOnCanvas(`edge.${e.name}`)
                  close()
                }}
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
                onSelect={() => {
                  setSection('schema')
                  showDomain(p.domainId)
                  focusClass(`class.${p.owner}`, p.domainId)
                  revealOnCanvas(`class.${p.owner}`)
                  close()
                }}
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
                onSelect={() => {
                  setSection('schema')
                  showDomain(m.domainId)
                  if (m.firstClass) {
                    focusClass(`class.${m.firstClass}`, m.domainId)
                    revealOnCanvas(`class.${m.firstClass}`)
                  }
                  close()
                }}
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
                value={`open ${domain.origin} ${o.label} ${o.key} overview`}
                className={ITEM_CLS}
                onSelect={() => {
                  setSection('schema')
                  showDomain(domain.id)
                  setPanelOverlay(o.key, domain.id)
                  close()
                }}
              >
                <Row icon={o.icon} label={o.label} meta={domain.origin} />
              </Command.Item>
            )),
          )}
        </Command.Group>

        <Command.Group heading="Go to">
          {SECTIONS.map((s) => (
            <Command.Item
              key={`section.${s.key}`}
              value={`go to ${s.label} ${s.key} section`}
              className={ITEM_CLS}
              onSelect={() => {
                setSection(s.key)
                close()
              }}
            >
              <Row icon={ArrowRight} label={s.label} meta="section" />
            </Command.Item>
          ))}
        </Command.Group>
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
