/**
 * The outline's behaviour, headless: which rows are open, which one is selected and
 * focused, and what each key does. It renders nothing; it hands out the props that
 * make any markup an ARIA tree.
 */
import type * as React from 'react'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { OutlineNode } from './model'

import { ancestorsOf, moveFor, outlineRows, rowStartingWith, type OutlineRow } from './rows'

/** Explicit open (`true`) or closed (`false`) states; an absent id falls back to the default. */
export type OutlineExpansion = Readonly<Record<string, boolean>>

export interface UseOutlineOptions {
  nodes: readonly OutlineNode[]
  /** Controlled expansion when the key is present; pair with `onExpansionChange`. */
  expansion?: OutlineExpansion
  defaultExpansion?: OutlineExpansion
  onExpansionChange?: (expansion: OutlineExpansion) => void
  /** Whether a node without an explicit state is open. Default: modules open, the rest closed. */
  openByDefault?: (node: OutlineNode) => boolean
  /**
   * Controlled selection when the key is present, `undefined` meaning nothing is
   * selected: a node `target`, as the Studio selects it.
   */
  selected?: string
  defaultSelected?: string
  onSelect?: (node: OutlineNode) => void
  filter?: string
}

export interface OutlineRowProps {
  role: 'treeitem'
  'aria-label': string
  tabIndex: 0 | -1
  'aria-level': number
  'aria-setsize': number
  'aria-posinset': number
  'aria-expanded'?: boolean
  'aria-selected': boolean
  /** The node's id, unique within one outline (several outlines may share a page). */
  'data-outline-id': string
  'data-kind': OutlineNode['kind']
  'data-reference'?: ''
  'data-expanded'?: ''
  'data-selected'?: ''
  'data-current'?: ''
  'data-focused'?: ''
  style: React.CSSProperties
  ref: (element: HTMLElement | null) => void
  onClick: (event: React.MouseEvent) => void
  onFocus: () => void
}

export interface Outline {
  rows: OutlineRow[]
  focused?: string
  toggle: (id: string) => void
  setExpanded: (id: string, open: boolean) => void
  select: (node: OutlineNode) => void
  treeProps: {
    role: 'tree'
    onKeyDown: (event: React.KeyboardEvent) => void
  }
  rowProps: (row: OutlineRow) => OutlineRowProps
  /** For a disclosure control inside a row: toggles without selecting. */
  toggleProps: (row: OutlineRow) => {
    tabIndex: -1
    'aria-hidden': true
    onClick: (event: React.MouseEvent) => void
  }
}

const openModules = (node: OutlineNode) => node.kind === 'module'

/** A value the caller owns when it passes one, even `undefined`; otherwise this hook does. */
function useControllable<T>(
  controlled: boolean,
  value: T,
  initial: T,
  onChange?: (next: T) => void,
) {
  const [own, setOwn] = useState(initial)
  const current = controlled ? value : own
  const latest = useRef(current)
  latest.current = current
  const set = useCallback(
    (next: T) => {
      if (!controlled) setOwn(next)
      onChange?.(next)
    },
    [controlled, onChange],
  )
  return [current, set, latest] as const
}

const TYPE_AHEAD_MS = 500

export function useOutline(options: UseOutlineOptions): Outline {
  const { nodes, onSelect, filter } = options
  const openByDefault = options.openByDefault ?? openModules
  const [expansion, setExpansion, latestExpansion] = useControllable<OutlineExpansion>(
    Object.hasOwn(options, 'expansion'),
    options.expansion ?? {},
    options.defaultExpansion ?? {},
    options.onExpansionChange,
  )
  const [selected, setSelected] = useControllable(
    Object.hasOwn(options, 'selected'),
    options.selected,
    options.defaultSelected,
  )
  const [focused, setFocused] = useState<string>()
  const elements = useRef(new Map<string, HTMLElement>())
  const typed = useRef({ text: '', at: 0 })

  const isExpanded = useCallback(
    (node: OutlineNode) => expansion[node.id] ?? openByDefault(node),
    [expansion, openByDefault],
  )
  const rows = useMemo(
    () => outlineRows(nodes, { isExpanded, selected, filter }),
    [nodes, isExpanded, selected, filter],
  )
  const byId = useMemo(() => new Map(rows.map((row) => [row.node.id, row])), [rows])
  // A focus whose row went away (folded, filtered, another lens) falls back to the first row.
  const focus = focused && byId.has(focused) ? focused : rows[0]?.node.id

  const setExpanded = useCallback(
    (id: string, open: boolean) => setExpansion({ ...latestExpansion.current, [id]: open }),
    [setExpansion, latestExpansion],
  )
  const toggle = useCallback(
    (id: string) => {
      const row = byId.get(id)
      if (row) setExpanded(id, !row.expanded)
    },
    [byId, setExpanded],
  )
  const select = useCallback(
    (node: OutlineNode) => {
      if (node.target) setSelected(node.target)
      onSelect?.(node)
    },
    [setSelected, onSelect],
  )

  const moveFocus = useCallback((id: string) => {
    setFocused(id)
    elements.current.get(id)?.focus()
  }, [])

  // A selection made elsewhere (the canvas, a link) opens its way down and comes into
  // view: once per selection, and again when the tree changes under it (another lens).
  const revealed = useRef<{ selected?: string; nodes?: readonly OutlineNode[] }>({})
  useEffect(() => {
    if (!selected || (revealed.current.selected === selected && revealed.current.nodes === nodes))
      return
    revealed.current = { selected, nodes }
    const shut = (ancestorsOf(nodes, selected) ?? []).filter(
      (node) => !(latestExpansion.current[node.id] ?? openByDefault(node)),
    )
    if (shut.length > 0) {
      setExpansion({
        ...latestExpansion.current,
        ...Object.fromEntries(shut.map((node) => [node.id, true])),
      })
    }
  }, [selected, nodes, openByDefault, setExpansion, latestExpansion])
  const home = rows.find((row) => row.selected)?.node.id
  useEffect(() => {
    if (home) elements.current.get(home)?.scrollIntoView({ block: 'nearest' })
  }, [home])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const move = moveFor(rows, focus, event.key)
      if (move) {
        event.preventDefault()
        if ('focus' in move) moveFocus(move.focus)
        else if ('expand' in move) setExpanded(move.expand, true)
        else if ('collapse' in move) setExpanded(move.collapse, false)
        else if ('expandSiblings' in move) {
          setExpansion({
            ...latestExpansion.current,
            ...Object.fromEntries(move.expandSiblings.map((id) => [id, true])),
          })
        } else {
          const row = byId.get(move.select)
          if (row?.node.target) select(row.node)
          else if (row?.expandable) toggle(row.node.id)
        }
        return
      }
      if (event.key.length === 1 && event.key !== ' ') {
        const now = Date.now()
        const text =
          now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text + event.key : event.key
        typed.current = { text, at: now }
        const id = rowStartingWith(rows, focus, text)
        if (id) {
          event.preventDefault()
          moveFocus(id)
        }
      }
    },
    [rows, focus, byId, moveFocus, setExpanded, setExpansion, latestExpansion, select, toggle],
  )

  const rowProps = useCallback(
    (row: OutlineRow): OutlineRowProps => {
      const { node } = row
      return {
        role: 'treeitem',
        'aria-label': node.detail ? `${node.label} ${node.detail}` : node.label,
        tabIndex: node.id === focus ? 0 : -1,
        'aria-level': row.level,
        'aria-setsize': row.setSize,
        'aria-posinset': row.position,
        ...(row.expandable ? { 'aria-expanded': row.expanded } : {}),
        'aria-selected': row.selected,
        'data-outline-id': node.id,
        'data-kind': node.kind,
        ...(node.reference ? { 'data-reference': '' as const } : {}),
        ...(row.expanded ? { 'data-expanded': '' as const } : {}),
        ...(row.selected ? { 'data-selected': '' as const } : {}),
        ...(row.current ? { 'data-current': '' as const } : {}),
        ...(node.id === focus ? { 'data-focused': '' as const } : {}),
        style: {
          '--outline-level': row.level,
          ...(node.hue !== undefined ? { '--outline-hue': node.hue } : {}),
        } as React.CSSProperties,
        ref: (element) => {
          if (element) elements.current.set(node.id, element)
          else elements.current.delete(node.id)
        },
        onClick: (event) => {
          event.stopPropagation()
          setFocused(node.id)
          if (node.target) select(node)
          else if (row.expandable) toggle(node.id)
        },
        onFocus: () => setFocused(node.id),
      }
    },
    [focus, select, toggle],
  )

  const toggleProps = useCallback(
    (row: OutlineRow) => ({
      tabIndex: -1 as const,
      'aria-hidden': true as const,
      onClick: (event: React.MouseEvent) => {
        event.stopPropagation()
        toggle(row.node.id)
      },
    }),
    [toggle],
  )

  return {
    rows,
    focused: focus,
    toggle,
    setExpanded,
    select,
    treeProps: { role: 'tree', onKeyDown },
    rowProps,
    toggleProps,
  }
}
