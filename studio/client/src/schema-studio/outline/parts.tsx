/**
 * The outline's unstyled parts. Each one wires the behaviour `useOutline` hands out
 * onto a plain element and exposes its state as `data-*` attributes and the
 * `--outline-level` / `--outline-hue` custom properties, so a skin is CSS alone.
 */
import type * as React from 'react'

import {
  AppWindow,
  Box,
  FolderClosed,
  FolderOpen,
  type LucideIcon,
  PenLine,
  Search,
  ShieldCheck,
  Spline,
  SquareFunction,
} from 'lucide-react'

import type { OutlineKind, OutlineNode } from './model'
import type { OutlineRow as Row } from './rows'
import type { Outline } from './use-outline'

import { SchemaIcon } from '../schema-icon'

/** One icon per kind of thing. */
export const OUTLINE_ICONS: Record<OutlineKind, LucideIcon> = {
  module: FolderClosed,
  class: Box,
  link: Spline,
  function: SquareFunction,
  query: Search,
  mutation: PenLine,
  view: AppWindow,
  rule: ShieldCheck,
}

type DivProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'role' | 'onKeyDown'>

export function OutlineRoot({ outline, ...props }: DivProps & { outline: Outline }) {
  return <div {...props} {...outline.treeProps} />
}

/** One row of the tree. Nesting is carried by `aria-level`, so rows render flat. */
export function OutlineRow({
  outline,
  row,
  style,
  ...props
}: DivProps & { outline: Outline; row: Row }) {
  const { ref, style: rowStyle, ...rowProps } = outline.rowProps(row)
  return <div {...props} {...rowProps} ref={ref} style={{ ...rowStyle, ...style }} />
}

/** The disclosure control of an expandable row; empty for a row with nothing beneath. */
export function OutlineToggle({
  outline,
  row,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { outline: Outline; row: Row }) {
  if (!row.expandable) return <span {...props} aria-hidden data-outline-toggle="" data-empty="" />
  return (
    <span {...props} {...outline.toggleProps(row)} data-outline-toggle="">
      {children}
    </span>
  )
}

/** A Class's own icon when it has one; otherwise the icon of the node's kind. */
export function OutlineIcon({
  node,
  expanded,
  className,
  style,
}: {
  node: OutlineNode
  expanded?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  if (node.svg) return <SchemaIcon svg={node.svg} className={className} style={style} />
  const Icon = node.kind === 'module' && expanded ? FolderOpen : OUTLINE_ICONS[node.kind]
  return <Icon aria-hidden className={className} style={style} data-outline-icon="" />
}
