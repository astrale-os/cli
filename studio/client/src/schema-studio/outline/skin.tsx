/**
 * The Studio's look for the outline: the module tree's rows, tints and icons, drawn
 * on the unstyled parts. Every rule keys off the parts' `data-*` state, so another
 * skin replaces this file and touches nothing else.
 */
import type * as React from 'react'

import { ChevronDown, ChevronRight, Network, Workflow } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { OutlineRow as Row } from './rows'
import type { Outline } from './use-outline'

import { moduleTint } from '../palette'
import { OUTLINE_LENSES, type OutlineKind, type OutlineLens } from './model'
import { OutlineIcon, OutlineRoot, OutlineRow, OutlineToggle } from './parts'

const ICON_COLORS: Record<OutlineKind, string> = {
  module: '',
  class: 'text-schema-node',
  link: 'text-schema-edge',
  function: 'text-schema-function',
  query: 'text-schema-function',
  mutation: 'text-warning',
  view: 'text-schema-view',
  rule: 'text-success',
}

const ROW = cn(
  'group flex w-full cursor-default items-center gap-1 rounded-md py-1 pr-2 text-left outline-none',
  // one step of the hierarchy is 12px, under the rail's own indent
  'pl-[calc(var(--outline-indent,0px)+(var(--outline-level)-1)*12px+8px)]',
  'hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
  'data-[selected]:bg-accent data-[selected]:font-semibold',
  'data-[current]:bg-accent/50',
  'data-[kind=module]:font-medium',
  'data-[reference]:text-muted-foreground',
  // set by the host through `rowAttributes`: the row's member is off the canvas
  'data-[hidden]:opacity-45',
)

export function OutlineSkin({
  outline,
  indent = 0,
  trailing,
  rowAttributes,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'role' | 'onKeyDown'> & {
  outline: Outline
  /** Pixels every row is pushed right by, under whatever owns the tree. */
  indent?: number
  /** Controls at the end of a row, such as the canvas visibility toggle. */
  trailing?: (row: Row) => React.ReactNode
  /** Extra `data-*` attributes on a row, such as the comment anchor it carries. */
  rowAttributes?: (row: Row) => Record<`data-${string}`, string | undefined>
}) {
  return (
    <OutlineRoot
      outline={outline}
      className={cn('pb-1.5 text-[13px]', className)}
      style={{ '--outline-indent': `${indent}px` } as React.CSSProperties}
      {...props}
    >
      {outline.rows.map((row) => (
        <SkinRow
          key={row.node.id}
          outline={outline}
          row={row}
          trailing={trailing}
          attributes={rowAttributes?.(row)}
        />
      ))}
    </OutlineRoot>
  )
}

function SkinRow({
  outline,
  row,
  trailing,
  attributes,
}: {
  outline: Outline
  row: Row
  trailing?: (row: Row) => React.ReactNode
  attributes?: Record<`data-${string}`, string | undefined>
}) {
  const { node } = row
  const Chevron = row.expanded ? ChevronDown : ChevronRight
  return (
    <OutlineRow
      outline={outline}
      row={row}
      className={ROW}
      title={node.description ?? (node.detail ? `${node.label} ${node.detail}` : node.label)}
      data-tree-row=""
      {...attributes}
    >
      <OutlineToggle
        outline={outline}
        row={row}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
      >
        <Chevron className="size-3" />
      </OutlineToggle>
      <OutlineIcon
        node={node}
        expanded={row.expanded}
        className={cn(
          'shrink-0',
          node.svg ? 'size-4' : 'size-3.5',
          node.reference && 'size-3',
          ICON_COLORS[node.kind],
        )}
        style={
          node.kind === 'module' && node.hue !== undefined
            ? { color: moduleTint(node.hue).mark }
            : undefined
        }
      />
      {/* one line of text, so the ellipsis eats the detail before the name */}
      <span className="min-w-0 truncate">
        {node.label}
        {node.detail && (
          <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
            {node.detail}
          </span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">{trailing?.(row)}</span>
    </OutlineRow>
  )
}

const LENSES: Record<OutlineLens, { label: string; hint: string; icon: typeof Network }> = {
  relational: {
    label: 'Relational',
    hint: 'The data: Classes with the rules on their data, and the relationships between them',
    icon: Network,
  },
  functional: {
    label: 'Functional',
    hint: 'What runs: functions and their anchors, queries, mutations and Views',
    icon: Workflow,
  },
}

/** The outline's lens, one pressed at a time. */
export function OutlineLensSwitch({
  lens,
  onChange,
  className,
}: {
  lens: OutlineLens
  onChange: (lens: OutlineLens) => void
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Outline lens"
      className={cn('flex gap-0.5 rounded-md bg-muted p-0.5', className)}
    >
      {OUTLINE_LENSES.map((candidate) => {
        const { label, hint, icon: Icon } = LENSES[candidate]
        const checked = candidate === lens
        return (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={checked}
            title={hint}
            onClick={() => onChange(candidate)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
              checked
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        )
      })}
    </div>
  )
}
