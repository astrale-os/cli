/**
 * The Index: the current Scene as a list down the left of the canvas. It lists what the
 * canvas draws, grouped as the canvas groups it, and shares its selection, its hover and
 * its collapsed modules — so pointing at a row points at the card, and the reverse.
 *
 * Keyboard: ↑/↓ move between rows, ← / → close and open a module (or step to its header),
 * Enter selects; from the search field ↓ enters the list and Enter selects the first match.
 *
 * On a canvas of several Domains each Domain is a row of its own, which opens and shuts in the
 * Index alone: the canvas draws every area it lists.
 *
 * The filter filters the canvas too: what it leaves out steps back there (`onFilter`). Every
 * entry is told apart at the rail's width, its count in view (`linesApart`).
 */

import { ChevronDown, ChevronRight, Globe, House, PanelLeftClose, Search, X } from 'lucide-react'
import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { domainAnchorRef, targetSurface } from '@/lib/targets'
import { cn } from '@/lib/utils'

import type { Scene } from '../scene/types'

import { moduleTint } from '../../schema-studio/palette'
import { SchemaIcon } from '../../schema-studio/schema-icon'
import { ModulesSidebar, useRailCollapse } from '../../schema-studio/sidebar'
import { commentTarget } from '../canvas/comment-target'
import { GLYPHS } from '../canvas/glyphs'
import { pointing } from '../canvas/pointer'
import { useCanvas } from '../canvas/store'
import { TONE_TEXT } from '../canvas/tones'
import { OpMarks } from '../rules/rule-mark'
import { linesApart, measureIn } from './label-lines'
import {
  type IndexAreaRow,
  type IndexItemRow,
  type IndexRow,
  indexKinds,
  indexRows,
  kindLabel,
} from './model'

export interface IndexRailProps {
  scene: Scene | undefined
  domainId: string
  selected?: string
  collapsed: ReadonlySet<string>
  onToggleGroup: (group: string) => void
  onSelect: (id: string) => void
  onClearSelection: () => void
  /** the entries the filter keeps while it filters, else null: the canvas steps the rest back */
  onFilter?: (ids: readonly string[] | null) => void
}

/** What an item row takes beside its name: its indent, glyph, gap and right padding. */
const ROW_CHROME = {
  grouped: 28,
  loose: 10,
  /** what a row listed under a Domain's row adds to its indent */
  area: 12,
  glyph: 14,
  gap: 6,
  end: 8,
  mark: 14,
  markGap: 2,
} as const

export function IndexRail({
  scene,
  domainId,
  selected,
  collapsed,
  onToggleGroup,
  onSelect,
  onClearSelection,
  onFilter,
}: IndexRailProps) {
  const [query, setQuery] = useState('')
  // The kinds whose chip was pressed: shown when the Scene lists them behind it, else hidden.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const hidden = useMemo(() => {
    const off = new Set(scene?.index?.hiddenKinds ?? [])
    const result = new Set<string>()
    for (const kind of new Set([...off, ...toggled]))
      if (off.has(kind) !== toggled.has(kind)) result.add(kind)
    return result as ReadonlySet<string>
  }, [scene, toggled])
  const hovered = useCanvas((state) => state.hovered)
  const setHovered = useCanvas((state) => state.setHovered)
  const listRef = useRef<HTMLDivElement>(null)
  // The Domains shut in the Index, on a canvas of several.
  const [shutAreas, setShutAreas] = useState<ReadonlySet<string>>(new Set())
  const shut = useMemo(
    () => (shutAreas.size > 0 ? new Set([...collapsed, ...shutAreas]) : collapsed),
    [collapsed, shutAreas],
  )
  const toggleArea = (area: string) =>
    setShutAreas((current) => {
      const next = new Set(current)
      if (next.has(area)) next.delete(area)
      else next.add(area)
      return next
    })
  const toggle = (row: IndexRow) =>
    row.type === 'area' ? toggleArea(row.id) : onToggleGroup(row.id)

  const kinds = useMemo(() => (scene ? indexKinds(scene) : []), [scene])
  const rows = useMemo(
    () => (scene ? indexRows(scene, { query, hidden }, shut) : []),
    [hidden, query, scene, shut],
  )
  // What the filter keeps, whatever is collapsed or hidden in the list, steps forward on the canvas.
  const kept = useMemo(
    () =>
      scene && query.trim()
        ? indexRows(scene, { query, hidden: new Set() }, new Set())
            .filter((row) => row.type === 'item')
            .map((row) => row.id)
        : null,
    [query, scene],
  )
  useEffect(() => onFilter?.(kept), [kept, onFilter])
  useEffect(() => () => onFilter?.(null), [onFilter])

  // Each name in the room its row leaves it at the rail's width.
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = listRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const lines = useMemo(() => {
    const element = listRef.current
    const items = rows.filter((row): row is IndexItemRow => row.type === 'item')
    if (!element || width === 0) return new Map<string, string[]>()
    const name = measureIn(element, 12.5)
    const count = measureIn(element, 11)
    const fitted = linesApart(
      items.map((row) => {
        // A count keeps its width; a keyword the filter matched, or a sublabel, gives way to
        // the name.
        const marks = row.ops?.length ?? 0
        const room =
          width -
          (row.group ? ROW_CHROME.grouped : ROW_CHROME.loose) -
          (row.area ? ROW_CHROME.area : 0) -
          ROW_CHROME.glyph -
          ROW_CHROME.gap -
          ROW_CHROME.end -
          (marks > 0
            ? marks * ROW_CHROME.mark + (marks - 1) * ROW_CHROME.markGap + ROW_CHROME.gap
            : 0)
        const beside = Math.min(
          row.matched ? count(`· ${row.matched}`) : row.sublabel ? count(row.sublabel) : 0,
          room * 0.4,
        )
        return { name: row.label, room: room - (beside > 0 ? beside + ROW_CHROME.gap : 0) }
      }),
      name,
    )
    return new Map(items.map((row, index) => [row.id, fitted[index]!]))
  }, [rows, width])
  const groupOf = useMemo(
    () => new Map((scene?.index?.groups ?? scene?.groups ?? []).map((group) => [group.id, group])),
    [scene],
  )

  // A selection made on the canvas brings its row into view.
  useEffect(() => {
    if (!selected) return
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-index-row="${CSS.escape(selected)}"]`,
    )
    row?.scrollIntoView({ block: 'nearest' })
  }, [selected, rows])

  const rowElements = () => [
    ...(listRef.current?.querySelectorAll<HTMLElement>('[data-index-row]') ?? []),
  ]
  const focusRow = (element: HTMLElement | undefined) => {
    if (!element) return
    element.focus()
    element.scrollIntoView({ block: 'nearest' })
  }

  const activate = (row: IndexRow) => (row.type === 'item' ? onSelect(row.id) : toggle(row))

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const elements = rowElements()
    const current = (event.target as HTMLElement).closest<HTMLElement>('[data-index-row]')
    const index = current ? elements.indexOf(current) : -1
    const row = rows.find((candidate) => candidate.id === current?.dataset.indexRow)
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusRow(elements[Math.min(elements.length - 1, index + 1)])
        return
      case 'ArrowUp':
        event.preventDefault()
        focusRow(elements[Math.max(0, index - 1)])
        return
      case 'Home':
        event.preventDefault()
        focusRow(elements[0])
        return
      case 'End':
        event.preventDefault()
        focusRow(elements.at(-1))
        return
      case 'Enter':
      case ' ':
        if (!row) return
        event.preventDefault()
        activate(row)
        return
      case 'ArrowLeft': {
        if (!row) return
        event.preventDefault()
        if (row.type !== 'item' && !row.collapsed) return toggle(row)
        const up =
          row.type === 'item'
            ? (row.group ?? row.area)
            : row.type === 'group'
              ? row.area
              : undefined
        if (up) focusRow(elements.find((element) => element.dataset.indexRow === up))
        return
      }
      case 'ArrowRight':
        if (!row || row.type === 'item') return
        event.preventDefault()
        if (row.collapsed) toggle(row)
        else focusRow(elements[index + 1])
        return
    }
  }

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusRow(rowElements()[0])
    } else if (event.key === 'Enter') {
      const first = rows.find((row): row is IndexItemRow => row.type === 'item')
      if (first) onSelect(first.id)
    } else if (event.key === 'Escape' && query) {
      event.preventDefault()
      setQuery('')
    }
  }

  const toggleKind = (kind: string) =>
    setToggled((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  // The row Tab lands on: the selection when it is listed, the first row otherwise.
  const tabStop = rows.some((row) => row.id === selected) ? selected : rows[0]?.id

  return (
    <ModulesSidebar name="Index" onClearSelection={onClearSelection} header={<IndexHeader />}>
      <div
        data-index-rail=""
        data-testid="index-rail"
        {...targetSurface('index')}
        className="flex h-full flex-col"
      >
        <div className="space-y-2 border-b px-2.5 pb-2.5 pt-2">
          <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-[12px] focus-within:border-ring">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="search"
              value={query}
              placeholder="Filter the canvas"
              aria-label="Filter the Index"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKey}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear the filter"
                onClick={() => setQuery('')}
                className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          {kinds.length > 1 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Kinds">
              {kinds.map(({ kind, count }) => {
                const shown = !hidden.has(kind)
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={shown}
                    onClick={() => toggleKind(kind)}
                    className={cn(
                      'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors',
                      shown
                        ? 'border-transparent bg-accent text-foreground'
                        : 'border-dashed text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {kindLabel(kind, count)}
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div
            ref={listRef}
            role="tree"
            aria-label="Index"
            className="py-1"
            onKeyDown={onListKey}
            onPointerLeave={() => setHovered(null)}
          >
            {rows.map((row) =>
              row.type === 'area' ? (
                <AreaRowView
                  key={row.id}
                  row={row}
                  tabStop={tabStop === row.id}
                  onToggle={() => toggleArea(row.id)}
                />
              ) : row.type === 'group' ? (
                <GroupRowView
                  key={row.id}
                  id={row.id}
                  label={row.label}
                  hue={groupOf.get(row.id)?.hue}
                  count={row.count}
                  collapsed={row.collapsed}
                  selected={selected === row.id}
                  hovered={hovered === row.id}
                  tabStop={tabStop === row.id}
                  domainId={groupOf.get(row.id)?.anchorDomain ?? domainId}
                  anchor={groupOf.get(row.id)?.anchor}
                  inArea={row.area !== undefined}
                  onToggle={() => onToggleGroup(row.id)}
                  onSelect={() => onSelect(row.id)}
                  onHover={setHovered}
                />
              ) : (
                <ItemRowView
                  key={row.id}
                  row={row}
                  lines={lines.get(row.id)}
                  selected={selected === row.id}
                  hovered={hovered === row.id}
                  tabStop={tabStop === row.id}
                  domainId={domainId}
                  onSelect={() => onSelect(row.id)}
                  onHover={setHovered}
                />
              ),
            )}
            {scene && rows.length === 0 && (
              <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
                {query
                  ? `Nothing on the canvas matches “${query}”.`
                  : kinds.length > 0
                    ? 'Nothing listed for these kinds.'
                    : (scene.index?.empty ?? 'Nothing to list.')}
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </ModulesSidebar>
  )
}

/** The rail's title bar and its own close button. The Domain it lists is named in the bar. */
function IndexHeader() {
  const rail = useRailCollapse()
  return (
    <header className="flex h-10 shrink-0 items-center gap-0.5 border-b px-3">
      <h2 className="mr-auto text-[13px] font-semibold">Index</h2>
      {rail && (
        <button
          type="button"
          title="Hide the Index"
          aria-label="Hide the Index"
          aria-expanded
          onClick={rail.collapse}
          className="-mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      )}
    </header>
  )
}

const ROW =
  'relative flex h-7 cursor-default items-center gap-1.5 pr-2 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'

/** A Domain's row on a canvas of several: its name and version, what it lists under it. */
function AreaRowView({
  row,
  tabStop,
  onToggle,
}: {
  row: IndexAreaRow
  tabStop: boolean
  onToggle: () => void
}) {
  const Icon = row.home ? House : Globe
  return (
    <div
      role="treeitem"
      aria-expanded={!row.collapsed}
      tabIndex={tabStop ? 0 : -1}
      data-index-row={row.id}
      data-index-area={row.origin}
      data-tree-row=""
      data-comment-outline-inset=""
      {...commentTarget(domainAnchorRef(row.origin), row.label, row.domainId)}
      className={cn(ROW, 'mt-1.5 pl-1.5 font-semibold hover:bg-accent/40')}
      onClick={onToggle}
    >
      <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center text-muted-foreground">
        {row.collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </span>
      {/* the hue its frame wears on the canvas */}
      <Icon
        aria-hidden
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: `oklch(0.68 0.12 ${row.hue})` }}
      />
      <span className="min-w-0 truncate text-[12.5px]">{row.label}</span>
      {row.version && (
        <span className="shrink-0 font-mono text-[10.5px] font-normal text-muted-foreground">
          {row.version}
        </span>
      )}
      <span className="ml-auto shrink-0 text-[11px] font-normal tabular-nums text-muted-foreground">
        {row.count}
      </span>
    </div>
  )
}

function GroupRowView({
  id,
  label,
  hue,
  count,
  collapsed,
  selected,
  hovered,
  tabStop,
  domainId,
  anchor,
  inArea,
  onToggle,
  onSelect,
  onHover,
}: {
  id: string
  label: string
  hue?: number
  count: number
  collapsed: boolean
  selected: boolean
  hovered: boolean
  tabStop: boolean
  domainId: string
  anchor?: string
  /** listed under a Domain's row */
  inArea: boolean
  onToggle: () => void
  onSelect: () => void
  onHover: (id: string | null) => void
}) {
  const tint = hue === undefined ? undefined : moduleTint(hue)
  return (
    <div
      role="treeitem"
      aria-expanded={!collapsed}
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      data-index-row={id}
      data-tree-row=""
      data-comment-outline-inset=""
      {...commentTarget(anchor ?? id, label, domainId)}
      className={cn(
        ROW,
        inArea ? 'mt-1 pl-[18px]' : 'mt-1 pl-1.5',
        selected ? 'bg-accent' : hovered ? 'bg-accent/60' : 'hover:bg-accent/40',
      )}
      onPointerEnter={(event) => {
        if (pointing.pointed(event.clientX, event.clientY)) onHover(id)
      }}
      onFocus={() => onHover(id)}
      onClick={onSelect}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${collapsed ? 'Open' : 'Close'} ${label}`}
        onClick={(event) => {
          event.stopPropagation()
          onToggle()
        }}
        className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-[3px]"
        style={{ background: tint?.mark ?? 'var(--color-muted-foreground)' }}
      />
      <span
        className="min-w-0 flex-1 truncate text-[11.5px] font-semibold uppercase tracking-wide"
        style={{ color: tint?.text }}
      >
        {label}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{count}</span>
    </div>
  )
}

function ItemRowView({
  row,
  lines,
  selected,
  hovered,
  tabStop,
  domainId,
  onSelect,
  onHover,
}: {
  row: IndexItemRow
  /** its name's lines, when it takes more than one */
  lines?: readonly string[]
  selected: boolean
  hovered: boolean
  tabStop: boolean
  domainId: string
  onSelect: () => void
  onHover: (id: string | null) => void
}) {
  const Glyph = GLYPHS[row.icon?.glyph ?? 'class']
  const tone = TONE_TEXT[row.tone ?? 'node']
  const wrapped = lines !== undefined && lines.length > 1
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      data-index-row={row.id}
      data-tree-row=""
      data-comment-outline-inset=""
      {...commentTarget(row.anchor ?? row.id, row.label, row.anchorDomain ?? domainId)}
      title={wrapped ? row.label : undefined}
      className={cn(
        ROW,
        wrapped && 'h-auto min-h-7 items-start py-1 leading-[18px]',
        row.area ? (row.group ? 'pl-10' : 'pl-[22px]') : row.group ? 'pl-7' : 'pl-2.5',
        selected
          ? 'bg-accent font-medium text-foreground before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary'
          : hovered
            ? 'bg-accent/60'
            : 'hover:bg-accent/40',
      )}
      onPointerEnter={(event) => {
        // A row the list reflows under a still pointer is not hovered.
        if (pointing.pointed(event.clientX, event.clientY)) onHover(row.id)
      }}
      onFocus={() => onHover(row.id)}
      onClick={onSelect}
    >
      {row.icon?.svg ? (
        <SchemaIcon
          svg={row.icon.svg}
          className={cn('h-3.5 w-3.5 shrink-0', wrapped && 'mt-0.5', tone)}
        />
      ) : (
        <Glyph aria-hidden className={cn('h-3.5 w-3.5 shrink-0', wrapped && 'mt-0.5', tone)} />
      )}
      {wrapped ? (
        <span className="flex min-w-0 shrink-0 flex-col" data-index-lines={lines.length}>
          {lines.map((line, index) => (
            <span key={index} className="truncate">
              {line}
            </span>
          ))}
        </span>
      ) : (
        // measured to fit, the name keeps its width and what follows it gives way
        <span className={cn('min-w-0 truncate', lines !== undefined && 'shrink-0')}>
          {row.label}
        </span>
      )}
      {row.matched ? (
        <span className="min-w-0 shrink truncate text-[11px] text-muted-foreground">
          · {row.matched}
        </span>
      ) : (
        row.sublabel && (
          <span
            className="min-w-0 shrink truncate text-[11px] text-muted-foreground"
            title={row.sublabel}
          >
            {row.sublabel}
          </span>
        )
      )}
      {row.ops && <OpMarks ops={row.ops} className={cn('ml-auto', wrapped && 'mt-0.5')} />}
    </div>
  )
}
