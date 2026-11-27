/**
 * The marks the canvas draws in SVG and their labels: trunks, the members they open
 * into, and the fans that reach from a junction to the boxes it accepts — lighter than any
 * link, so a relationship always reads before the set its end accepts.
 *
 * Every link is one `<g>` holding a wide invisible hit stroke and the visible one; the
 * group carries the link's comment anchor, so targeting thickens the line itself. A verb's
 * hue shows at rest; a kind's once the link is lit. A link to a hub is faint until lit.
 *
 * In a Scene of ribbons the ribbons are drawn first, and over them the links drawn alone:
 * those lit or under the pointer, and those no ribbon carries.
 */

import type { CSSProperties } from 'react'

import { Ban } from 'lucide-react'
import { memo, useMemo } from 'react'

import { anchorData } from '@/lib/targets'

import type { Arrangement, Trunk } from '../scene/arrange'
import type { RuleMark } from '../scene/rules'
import type { SceneLink, SceneTone } from '../scene/types'
import type { Emphasis, LineFocus } from './emphasis'
import type { Frame } from './frame'
import type { Point } from './geometry'

import { RuleMark as RuleMarkView } from '../rules/rule-mark'
import { HUED_TONES, linkName } from '../scene/types'
import { lineEmphasis, nameDrawn } from './emphasis'
import { memberRoutes, type PlacedLabel, runsBackwards } from './labels'
import { ribbonShapes } from './ribbons'
import { arrowHead, reversed, roundedPath, trimEnd } from './routes'
import { TONE_COLOR } from './tones'

const ARROW = 7

/** A line's hue: its tone's, but a function's lines read as inheritance does. */
const STROKE: Record<SceneTone, string> = { ...TONE_COLOR, fn: 'var(--color-edge-inherit)' }

/** The one hue every link says, when they agree; mixed verbs read neutral until opened. */
function toneOf(links: readonly SceneLink[]): SceneTone {
  const tone = links[0]?.tone ?? 'edge'
  if (links.every((link) => (link.tone ?? 'edge') === tone)) return tone
  return 'muted'
}

interface LinkMarkProps {
  id: string
  points: Point[]
  /** draw the arrowhead at the route's start instead of its end */
  arrowAtStart: boolean
  directed: boolean
  dashed: boolean
  tone: SceneTone
  /** faint until lit: the link reaches a hub */
  ambient: boolean
  emphasis: Emphasis
  selected: boolean
  hidden: boolean
  weight: number
  anchor?: string
  excerpt?: string
  hoverId: string
  selectId?: string
}

/** One drawn line: a trunk at rest, or one member of an open trunk. */
const LinkMark = memo(function LinkMark({
  id,
  points,
  arrowAtStart,
  directed,
  dashed,
  tone,
  ambient,
  emphasis,
  selected,
  hidden,
  weight,
  anchor,
  excerpt,
  hoverId,
  selectId,
}: LinkMarkProps) {
  const ordered = arrowAtStart ? reversed(points) : points
  const line = directed ? trimEnd(ordered, ARROW - 1) : ordered
  return (
    <g
      className="scene-link"
      data-link-mark={id}
      data-hover-id={hoverId}
      data-select-id={selectId}
      data-emphasis={emphasis}
      data-selected={selected || undefined}
      data-hidden={hidden || undefined}
      data-verb={HUED_TONES.has(tone) || undefined}
      data-ambient={ambient || undefined}
      {...(anchor ? anchorData(anchor, excerpt) : {})}
      style={{ '--link-tone': STROKE[tone], '--link-weight': weight } as CSSProperties}
    >
      <path className="scene-link-hit" d={roundedPath(points)} />
      <path className="scene-link-stroke" data-dashed={dashed || undefined} d={roundedPath(line)} />
      {directed && <path className="scene-link-arrow" d={arrowHead(ordered, ARROW)} />}
    </g>
  )
})

export interface LinksLayerProps {
  frame: Frame
  open: ReadonlySet<string>
  /** what every line reads against (`lineEmphasis`) */
  focus: LineFocus
  /** fans the pointer opens, drawn as if lit */
  peeked: ReadonlySet<string>
  selected?: string
  /** in a Scene of ribbons: how each ribbon reads, and the links drawn alone, by their curves */
  ribbons?: {
    emphasis: (id: string) => Emphasis | 'hidden'
    curves: ReadonlyMap<string, Point[]>
  }
}

/** What a stripe says, in its tooltip. */
const TONE_WORDS: Partial<Record<SceneTone, string>> = {
  create: 'creates',
  update: 'updates',
  delete: 'deletes',
  transition: 'transitions',
  link: 'links',
  unlink: 'unlinks',
  call: 'calls',
  warning: 'may repeat',
  muted: 'reads',
}

/** The name a box reads by, for a ribbon's tooltip. */
function boxName(arrangement: Arrangement, id: string): string {
  const box = arrangement.boxes.find((candidate) => candidate.id === id)
  if (box?.kind === 'node') return box.node.label
  if (box?.kind === 'group') return box.group.label
  return 'one of several'
}

function trunkDirection(
  arrangement: Arrangement,
  trunk: Trunk,
  links: ReadonlyMap<string, SceneLink>,
) {
  const members = trunk.links
    .map((id) => links.get(id))
    .filter((link): link is SceneLink => Boolean(link))
  const directed = members.every((link) => link.directed)
  const backwards = members.map((link) => runsBackwards(arrangement, trunk, link))
  // A closed trunk shows a direction only when every member agrees on it.
  const agreed = backwards.every((value) => value === backwards[0])
  return { directed: directed && agreed, backwards: backwards[0] === true, members }
}

/** Fans, then trunks and their members, under the boxes. */
export const LinksLayer = memo(function LinksLayer({
  frame,
  open,
  focus,
  peeked,
  selected,
  ribbons,
}: LinksLayerProps) {
  const { lit } = focus
  const { scene, arrangement, placement } = frame
  const links = useMemo(() => new Map(scene.links.map((link) => [link.id, link])), [scene])
  const shapes = useMemo(
    () => (arrangement.lines === 'ribbons' ? ribbonShapes(arrangement, placement.boxes) : []),
    [arrangement, placement.boxes],
  )
  const { bounds } = placement
  return (
    <svg
      className="scene-links"
      style={{
        left: bounds.x - 200,
        top: bounds.y - 200,
        width: bounds.width + 400,
        height: bounds.height + 400,
      }}
      viewBox={`${bounds.x - 200} ${bounds.y - 200} ${bounds.width + 400} ${bounds.height + 400}`}
    >
      {arrangement.fans.map((fan) => {
        const route = placement.routes.get(fan.id)
        if (!route) return null
        const emphasis: Emphasis = lit
          ? lit.fans.has(fan.id)
            ? 'lit'
            : 'dim'
          : peeked.has(fan.id)
            ? 'lit'
            : 'rest'
        return (
          <path
            key={fan.id}
            className="scene-fan"
            data-fan-id={fan.id}
            data-junction-id={fan.junction}
            data-hover-id={fan.junction}
            data-emphasis={emphasis}
            d={roundedPath(route)}
          />
        )
      })}
      {ribbons &&
        shapes.map((shape) => {
          const ribbon = arrangement.ribbons.find((candidate) => candidate.id === shape.id)!
          const state = ribbons.emphasis(shape.id)
          const only = ribbon.links.length === 1 ? links.get(ribbon.links[0]!) : undefined
          const says = shape.stripes
            .map((stripe) => `${TONE_WORDS[stripe.tone] ?? stripe.tone} ${stripe.count}`)
            .join(' · ')
          return (
            <g
              key={shape.id}
              className="scene-ribbon"
              data-ribbon-id={shape.id}
              data-hover-id={shape.id}
              data-select-id={only ? (only.opens ?? only.id) : undefined}
              data-emphasis={state === 'hidden' ? undefined : state}
              data-hidden={state === 'hidden' || undefined}
              data-ambient={ribbon.ambient || undefined}
            >
              <title>
                {`${boxName(arrangement, ribbon.from)} → ${boxName(arrangement, ribbon.to)} · ${says}${ribbon.ambient ? ' · most of the scene reaches it' : ''}`}
              </title>
              <path
                className="scene-ribbon-hit"
                d={shape.spine}
                style={{ strokeWidth: shape.width + 8 }}
              />
              {shape.stripes.map((stripe) => (
                <path
                  key={stripe.tone}
                  className="scene-ribbon-stripe"
                  d={stripe.d}
                  style={{ '--ribbon-tone': STROKE[stripe.tone] } as CSSProperties}
                />
              ))}
            </g>
          )
        })}
      {ribbons &&
        [...ribbons.curves].map(([id, points]) => {
          const link = links.get(id)
          if (!link) return null
          const emphasis = lineEmphasis(id, focus)
          return (
            <LinkMark
              key={id}
              id={id}
              points={points}
              arrowAtStart={false}
              directed={link.directed}
              dashed={link.dashed === true}
              tone={link.tone ?? 'edge'}
              ambient={link.ambient === true}
              emphasis={emphasis}
              selected={id === selected}
              hidden={false}
              weight={1}
              anchor={link.anchor}
              excerpt={linkName(link)}
              hoverId={link.from.nodes[0] ?? id}
              selectId={link.opens ?? link.id}
            />
          )
        })}
      {arrangement.trunks.map((trunk) => {
        const route = placement.routes.get(trunk.id)
        if (!route) return null
        const isOpen = open.has(trunk.id)
        const { directed, backwards, members } = trunkDirection(arrangement, trunk, links)
        const emphasis = lineEmphasis(trunk.id, focus)
        const single = members.length === 1 ? members[0] : undefined
        const routes = memberRoutes(trunk, route)
        return (
          <g key={trunk.id}>
            <LinkMark
              id={trunk.id}
              points={route}
              arrowAtStart={backwards}
              directed={directed}
              dashed={members.every((link) => link.dashed === true)}
              tone={toneOf(members)}
              ambient={members.every((link) => link.ambient === true)}
              emphasis={emphasis}
              selected={single !== undefined && single.id === selected}
              hidden={isOpen && members.length > 1}
              // A counted trunk draws heavier with what it carries; one its names say draws even.
              weight={scene.trunkLabel === 'labels' ? 1 : 1 + Math.min(3, members.length - 1) * 0.8}
              anchor={single?.anchor}
              excerpt={single?.label}
              hoverId={trunk.id}
              selectId={single?.opens ?? single?.id}
            />
            {members.length > 1 &&
              members.map((link) => (
                <LinkMark
                  key={link.id}
                  id={link.id}
                  points={routes.get(link.id) ?? route}
                  arrowAtStart={runsBackwards(arrangement, trunk, link)}
                  directed={link.directed}
                  dashed={link.dashed === true}
                  tone={link.tone ?? 'edge'}
                  ambient={link.ambient === true}
                  emphasis={lineEmphasis(link.id, focus)}
                  selected={link.id === selected}
                  hidden={!isOpen}
                  weight={1}
                  anchor={link.anchor}
                  excerpt={linkName(link)}
                  hoverId={trunk.id}
                  selectId={link.opens ?? link.id}
                />
              ))}
          </g>
        )
      })}
    </svg>
  )
})

/** What a restrict mark says, on hover: the Kernel's `restrict`, in plain words. */
const restrictTitle = (role: string | undefined) =>
  `${role ? `Each ${role}` : 'This end'} restricts: deleting a Node here is refused while it has this link, unless the same change deletes the link.`

/**
 * Link names and end counts, over everything; a name selects its link, and the rule mark
 * before it (`ruleMarks`, by label id) the rule it stands for. A name reads as its line does,
 * and is drawn only where its line says it (`nameDrawn`).
 */
export const LabelsLayer = memo(function LabelsLayer({
  labels,
  focus,
  selected,
  links,
  ruleMarks,
}: {
  labels: readonly PlacedLabel[]
  focus: LineFocus
  selected?: string
  links: ReadonlyMap<string, SceneLink>
  ruleMarks?: ReadonlyMap<string, RuleMark>
}) {
  return (
    <>
      {labels.map((label) => {
        if (!nameDrawn(label.id, focus)) return null
        const link = links.get(label.id)
        const mark = !label.end && !label.count ? ruleMarks?.get(label.id) : undefined
        const emphasis = lineEmphasis(label.id, focus)
        return (
          <div
            key={`${label.id}:${label.end ?? 'name'}`}
            className="scene-label"
            data-line={label.id}
            data-end={label.end}
            data-emphasis={emphasis}
            data-selected={label.id === selected || undefined}
            data-hover-id={label.id.startsWith('trunk:') ? label.id : undefined}
            // A name several lines share selects none of them; the lines do.
            data-select-id={
              label.end || label.count ? undefined : link ? (link.opens ?? link.id) : undefined
            }
            data-verb={(label.tone && !label.end) || undefined}
            data-restricts={label.restricts ? '' : undefined}
            title={label.restricts ? restrictTitle(label.restricts.role) : undefined}
            data-spoken={label.scale !== undefined || undefined}
            {...(link?.anchor && !label.end ? anchorData(link.anchor, linkName(link)) : {})}
            style={
              {
                // A name read at every zoom is drawn larger than its size, filling its place.
                transform: `translate(${label.x}px, ${label.y}px)${label.scale ? ` scale(${label.scale})` : ''}`,
                transformOrigin: '0 0',
                width: label.width / (label.scale ?? 1),
                height: label.height / (label.scale ?? 1),
                ...(label.tone ? { '--label-tone': STROKE[label.tone] } : {}),
              } as CSSProperties
            }
          >
            {mark && (
              <span
                className="scene-label-rule"
                data-select-id={mark.id}
                data-hover-id={mark.id}
                data-rule-tone="traverse"
                title={mark.title}
              >
                {mark.mark && <RuleMarkView mark={mark.mark} title={null} />}
              </span>
            )}
            {label.restricts && (
              <Ban
                aria-hidden
                className="scene-label-restrict"
                data-alone={!label.text || undefined}
              />
            )}
            {label.text}
            {label.count && <span className="scene-label-count">{label.count}</span>}
            {label.marks && <span className="scene-label-marks">{label.marks}</span>}
          </div>
        )
      })}
    </>
  )
})
