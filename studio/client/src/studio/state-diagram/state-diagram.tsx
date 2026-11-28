/**
 * A state machine drawn: the Studio's own looks over `useStateDiagram`. Small, it fits a side
 * panel and names no event until a state is pointed at — the line under it then says where that
 * state goes, and on what. Opened large, it writes every event on its arrow.
 *
 * Its colours are four custom properties, each with a default, so a host re-tints it without
 * touching it: `--sd-accent` (what is pointed at and what leaves it), `--sd-line`, `--sd-surface`
 * and `--sd-text`.
 */

import type { CSSProperties } from 'react'

import { Maximize2 } from 'lucide-react'
import { useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import type { DiagramEdge, Machine } from './layout'

import {
  type DiagramSize,
  type EdgeEmphasis,
  type StateDiagramOptions,
  type StateEmphasis,
  useStateDiagram,
} from './use-state-diagram'

const COLOURS = {
  '--sd-accent': 'var(--color-verb-transition)',
  '--sd-line': 'var(--color-muted-foreground)',
  '--sd-surface': 'var(--color-card)',
  '--sd-text': 'var(--color-foreground)',
} as CSSProperties

/** Text sizes, a line's weight, and how wide the clearing around an event name is. */
const FONT: Record<DiagramSize, { state: number; label: number; stroke: number; halo: number }> = {
  sm: { state: 10.5, label: 9, stroke: 1.1, halo: 3 },
  md: { state: 11.5, label: 9.5, stroke: 1.2, halo: 4 },
  lg: { state: 13.5, label: 11, stroke: 1.4, halo: 6 },
}

const EDGE_OPACITY: Record<EdgeEmphasis, number> = { rest: 0.6, leaves: 1, enters: 0.75, dim: 0.12 }
const STATE_OPACITY: Record<StateEmphasis, number> = { rest: 1, active: 1, near: 1, dim: 0.35 }

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

export interface StateDiagramProps extends StateDiagramOptions {
  machine: Machine
  /** the state a thing is in now: marked whatever is pointed at */
  current?: string
  /** what the machine is of (`Issue · status`): the name the diagram is read by, and its title opened large */
  title?: string
  /** offers to open it large, with every event on its arrow */
  expandable?: boolean
  /** the line under the diagram: its tally at rest, the state pointed at otherwise */
  caption?: boolean
  className?: string
}

export function StateDiagram({
  machine,
  current,
  title,
  expandable = false,
  caption = true,
  className,
  ...options
}: StateDiagramProps) {
  const size = options.size ?? 'sm'
  const diagram = useStateDiagram(machine, options)
  const [open, setOpen] = useState(false)
  const { layout, active } = diagram
  if (layout.states.length === 0) return null
  const font = FONT[size]
  const lit = (edge: DiagramEdge) => diagram.edgeEmphasis(edge) === 'leaves'

  return (
    <div
      data-state-diagram={size}
      data-active={active}
      className={cn('min-w-0', className)}
      style={COLOURS}
    >
      <svg
        role="group"
        aria-label={title ? `${title}: its states and transitions` : 'States and transitions'}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        className="block h-auto max-w-full overflow-visible"
      >
        {layout.start && (
          <g aria-hidden style={{ color: 'var(--sd-line)' }}>
            <circle
              cx={layout.start.x}
              cy={layout.start.y}
              r={font.stroke * 2.6}
              fill="currentColor"
            />
            <path
              d={layout.start.path}
              stroke="currentColor"
              strokeWidth={font.stroke}
              fill="none"
            />
            <path d={layout.start.head} fill="currentColor" />
          </g>
        )}
        {layout.edges.map((edge) => {
          const emphasis = diagram.edgeEmphasis(edge)
          const colour = emphasis === 'leaves' ? 'var(--sd-accent)' : 'var(--sd-line)'
          return (
            <g
              key={edge.id}
              data-edge={edge.id}
              data-route={edge.route}
              data-emphasis={emphasis}
              style={{
                color: colour,
                opacity: EDGE_OPACITY[emphasis],
                transition: 'opacity 120ms',
              }}
            >
              <title>{`${edge.from} → ${edge.to}: ${edge.events.join(', ')}`}</title>
              <path
                d={edge.path}
                fill="none"
                stroke="currentColor"
                strokeWidth={emphasis === 'leaves' ? font.stroke * 1.35 : font.stroke}
                strokeLinecap="round"
              />
              <path d={edge.head} fill="currentColor" />
            </g>
          )
        })}
        {layout.states.map((state) => {
          const emphasis = diagram.stateEmphasis(state.id)
          const on = emphasis === 'active'
          const here = current === state.id
          const stroke = on || here ? 'var(--sd-accent)' : 'var(--sd-line)'
          return (
            <g
              key={state.id}
              data-state={state.id}
              data-initial={state.initial || undefined}
              data-final={state.final || undefined}
              data-current={here || undefined}
              data-emphasis={emphasis}
              aria-label={`${state.id}${state.initial ? ', initial' : ''}${state.final ? ', final' : ''}${here ? ', current' : ''}`}
              className="cursor-pointer outline-none"
              style={{ opacity: STATE_OPACITY[emphasis], transition: 'opacity 120ms' }}
              {...diagram.stateProps(state.id)}
            >
              <rect
                x={state.x}
                y={state.y}
                width={state.width}
                height={state.height}
                rx={state.height / 2}
                fill={
                  here
                    ? 'color-mix(in oklch, var(--sd-accent) 16%, var(--sd-surface))'
                    : on
                      ? 'color-mix(in oklch, var(--sd-accent) 9%, var(--sd-surface))'
                      : 'var(--sd-surface)'
                }
                stroke={stroke}
                strokeOpacity={on || here ? 1 : 0.55}
                strokeWidth={on || here ? font.stroke * 1.35 : font.stroke}
              />
              {/* a state nothing leaves is ringed twice, as a final state is drawn */}
              {state.final && (
                <rect
                  x={state.x + 2.5}
                  y={state.y + 2.5}
                  width={state.width - 5}
                  height={state.height - 5}
                  rx={(state.height - 5) / 2}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity={on || here ? 0.8 : 0.4}
                  strokeWidth={font.stroke * 0.8}
                />
              )}
              <text
                x={state.x + state.width / 2}
                y={state.y + state.height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={font.state}
                fontWeight={on || here ? 600 : 500}
                className="select-none font-mono"
                fill="var(--sd-text)"
              >
                {state.id}
              </text>
            </g>
          )
        })}
        {/* event names, over everything: every arrow's when the size writes them, else none */}
        {diagram.metrics.labels &&
          layout.edges.map((edge) => {
            const emphasis = diagram.edgeEmphasis(edge)
            if (emphasis === 'dim') return null
            const first =
              edge.label.y - ((edge.events.length - 1) * diagram.metrics.labelHeight) / 2
            return (
              <text
                key={edge.id}
                data-edge-label={edge.id}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={font.label}
                className="pointer-events-none select-none font-mono"
                fill={lit(edge) ? 'var(--sd-accent)' : 'var(--sd-text)'}
                fillOpacity={lit(edge) ? 1 : 0.72}
                stroke="var(--sd-surface)"
                strokeWidth={font.halo}
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {edge.events.map((event, index) => (
                  <tspan
                    key={event}
                    x={edge.label.x}
                    y={first + index * diagram.metrics.labelHeight}
                  >
                    {event}
                  </tspan>
                ))}
              </text>
            )
          })}
      </svg>
      {(caption || expandable) && (
        <div className="mt-1.5 flex min-h-[18px] items-start gap-2 text-[11.5px] leading-[18px] text-muted-foreground">
          {caption && (
            <p data-state-diagram-caption="" className="min-w-0 flex-1">
              {active === undefined ? (
                `${plural(layout.states.length, 'state')} · ${plural(machine.transitions.length, 'transition')}`
              ) : diagram.leaving.length === 0 ? (
                <>
                  <span className="font-mono text-foreground">{active}</span> is final: nothing
                  leaves it
                </>
              ) : (
                <>
                  <span className="font-mono text-foreground">{active}</span>
                  {diagram.leaving.map((edge) => (
                    <span key={edge.id} className="whitespace-nowrap">
                      {' · '}
                      <span className="font-mono" style={{ color: 'var(--sd-accent)' }}>
                        {edge.events.join(', ')}
                      </span>
                      {' → '}
                      <span className="font-mono text-foreground/85">{edge.to}</span>
                    </span>
                  ))}
                </>
              )}
            </p>
          )}
          {expandable && (
            <button
              type="button"
              data-state-diagram-expand=""
              aria-label="Open the diagram large"
              title="Open large, with every event"
              onClick={() => setOpen(true)}
              className="ml-auto inline-flex h-[18px] shrink-0 items-center rounded-sm px-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Maximize2 className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
      )}
      {expandable && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            data-state-diagram-dialog=""
            // opened, it reads at rest: focus stays off the first state
            onOpenAutoFocus={(event) => event.preventDefault()}
            className="flex max-h-[88vh] w-max max-w-[min(94vw,1240px)] flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle className="font-mono text-[14px]">
                {title ?? 'State machine'}
              </DialogTitle>
              <DialogDescription className="text-[12px]">
                {plural(layout.states.length, 'state')} ·{' '}
                {plural(machine.transitions.length, 'transition')}
                {machine.initial ? (
                  <>
                    {' · starts '}
                    <span className="font-mono">{machine.initial}</span>
                  </>
                ) : null}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-auto px-1 pb-1">
              <StateDiagram machine={machine} size="lg" {...(current ? { current } : {})} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
