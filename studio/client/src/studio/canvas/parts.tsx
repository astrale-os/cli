/**
 * The marks the canvas draws in HTML: cards, collapsed groups, junctions and module
 * regions. Each part lays itself out at the offsets its `BoxModel` computed, so what
 * renders is exactly what the layout reserved.
 */

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import { concreteAnchorKind } from '@shared/comment-anchors'
import { Box as BoxIcon, ChevronDown, ChevronRight, Layers, Spline } from 'lucide-react'
import { memo } from 'react'

import { cn } from '@/lib/utils'

import type { Box, JunctionBox } from '../scene/arrange'
import type { SceneBadge, SceneGroup, SceneRow, SceneSign } from '../scene/types'
import type { Emphasis } from './emphasis'
import type { Rect } from './geometry'
import type { Tier } from './viewport'

import { NodeCommentPin } from '../../schema-studio/node-comment-pin'
import { moduleTint } from '../../schema-studio/palette'
import { SchemaIcon } from '../../schema-studio/schema-icon'
import { ConstraintMark, RuleMark, RuleMarks } from '../rules/rule-mark'
import { commentTarget } from './comment-target'
import { GLYPHS } from './glyphs'
import { REGION_HEADER } from './layout'
import { measureText } from './measure'
import {
  type BoxModel,
  CARD,
  namesIn,
  PILL,
  type PlacedRule,
  RULE,
  type RuleGroup,
} from './metrics'
import { TONE_CHIP, TONE_COLOR } from './tones'

function Pin({ domainId, anchor, excerpt }: { domainId: string; anchor: string; excerpt: string }) {
  const kind = concreteAnchorKind(anchor)
  if (!kind) return null
  return <NodeCommentPin domainId={domainId} anchorRef={anchor} kind={kind} excerpt={excerpt} />
}

type CardBox = Exclude<Box, JunctionBox>

export interface BoxViewProps {
  box: CardBox
  model: BoxModel
  rect: Rect
  hue?: number
  tier: Tier
  emphasis: Emphasis
  selected: boolean
  /** the pointer is on this box or on what it stands for */
  hovered?: boolean
  domainId: string
  leaving?: boolean
  onToggleGroup: (group: string) => void
  /** opens or shuts a fold of the card's rules, for good */
  onToggleFold?: (fold: string) => void
  /** drawn over the map: a selection opened its folds, and the card stands taller than its place */
  raised?: boolean
  /**
   * for a group of rows or a card of rules: the selected id, the id under the pointer, and
   * the nodes or rules lit
   */
  selectedId?: string
  hoveredId?: string | null
  litNodes?: ReadonlySet<string> | null
  litRules?: ReadonlySet<string> | null
  /** for a card of rules: the rules asked for by their own id, whose names light in their rows */
  litNames?: ReadonlySet<string> | null
}

function boxAnchor(box: CardBox): { ref: string; excerpt: string; domainId?: string } {
  if (box.kind === 'node')
    return {
      ref: box.node.anchor ?? box.node.id,
      excerpt: box.node.label,
      ...(box.node.anchorDomain ? { domainId: box.node.anchorDomain } : {}),
    }
  return { ref: box.group.anchor ?? box.group.id, excerpt: box.group.label }
}

/** One box: a card, or a collapsed group. */
export const BoxView = memo(function BoxView({
  box,
  model,
  rect,
  hue,
  tier,
  emphasis,
  selected,
  hovered,
  domainId,
  leaving,
  onToggleGroup,
  onToggleFold,
  raised,
  selectedId,
  hoveredId,
  litNodes,
  litRules,
  litNames,
}: BoxViewProps) {
  const tint = hue === undefined ? undefined : moduleTint(hue)
  const tone = box.kind === 'node' ? (box.node.tone ?? 'node') : 'node'
  const mark = tint?.mark ?? TONE_COLOR[tone]
  const anchor = boxAnchor(box)
  const far = tier === 'far'
  const pill = box.kind === 'node' && box.node.shape === 'pill'
  const header = headerOf(model, far, box.kind === 'group', pill ? PILL.height : CARD.headerH)
  const open = box.kind === 'group' && box.open === true
  const icon = box.kind === 'node' ? box.node.icon : undefined
  const GlyphIcon = box.kind === 'group' ? Layers : icon?.glyph ? GLYPHS[icon.glyph] : BoxIcon
  const style = {
    transform: `translate(${rect.x}px, ${rect.y}px)`,
    width: rect.width,
    height: rect.height,
    '--box-mark': mark,
    ...(box.kind === 'group' && tint ? { background: tint.surface, borderColor: tint.border } : {}),
    ...(selected
      ? { background: tint?.wash, borderColor: mark, boxShadow: `0 0 0 2px ${mark}` }
      : {}),
  } as CSSProperties

  return (
    <div
      data-box-id={box.id}
      data-box-kind={box.kind}
      data-shape={pill ? 'pill' : undefined}
      data-hover-id={box.id}
      data-emphasis={emphasis}
      data-selected={selected || undefined}
      data-hovered={hovered || undefined}
      data-leaving={leaving || undefined}
      data-muted={tone === 'muted' || undefined}
      data-absent={(box.kind === 'node' && box.node.absent) || undefined}
      data-raised={raised || undefined}
      {...commentTarget(anchor.ref, anchor.excerpt, anchor.domainId)}
      className="scene-box"
      style={style}
    >
      <div className="scene-box-header" style={header.style}>
        {box.kind === 'group' ? (
          <button
            type="button"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${box.group.label}`}
            title={open ? 'Collapse the module' : 'Expand the module'}
            className="scene-box-toggle"
            onPointerDown={stopPointer}
            onClick={(event) => {
              event.stopPropagation()
              onToggleGroup(box.id)
            }}
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : far ? null : icon?.svg ? (
          <SchemaIcon svg={icon.svg} className="h-4 w-4" style={{ color: mark }} />
        ) : (
          <GlyphIcon className="h-4 w-4 shrink-0" style={{ color: mark }} />
        )}
        <span className="scene-box-title">{model.title}</span>
        {(far ? model.frame : model.sublabel) && (
          <span className="scene-box-sublabel">{far ? model.frame : model.sublabel}</span>
        )}
        {pill && !far && box.node.signs && box.node.signs.length > 0 && (
          <Signs signs={box.node.signs} />
        )}
        {header.counts > 0 && (
          <span className="scene-box-counts">
            {model.counts.slice(0, header.counts).map((count) => (
              <span
                key={count.label}
                title={`${count.value} ${count.label}`}
                className="scene-box-count"
              >
                {count.label === 'relationships' || count.label === 'links inside' ? (
                  <Spline className="h-[11px] w-[11px]" />
                ) : count.label === 'nodes' ? (
                  <BoxIcon className="h-[11px] w-[11px]" />
                ) : (
                  <span className="scene-box-count-dot" />
                )}
                {count.value}
              </span>
            ))}
          </span>
        )}
      </div>
      {!far &&
        model.tallies.map((tally) => (
          <span
            key={tally.label}
            className="scene-box-tally"
            title={tally.label}
            style={
              {
                left: tally.x,
                top: tally.y,
                width: tally.width,
                '--tally-tone': TONE_COLOR[tally.tone ?? 'muted'],
              } as CSSProperties
            }
          >
            <span className="scene-box-tally-dot" />
            {tally.label}
          </span>
        ))}
      {!far && model.badges.length > 0 && (
        <div className="scene-box-badges" style={{ top: model.badgesTop }}>
          {model.badges.map((badge) => (
            <BadgeView key={badge.label} badge={badge} />
          ))}
        </div>
      )}
      {model.rows.length > 0 && (
        <div className="scene-box-rows" style={{ top: model.rowsTop }}>
          {model.rows.map((row) => (
            <div
              key={row.id}
              className="scene-box-row"
              {...(model.memberRows ? memberRowData(row, selectedId, hoveredId, litNodes) : {})}
              {...commentTarget(row.anchor, row.label, row.anchorDomain)}
            >
              <span className="scene-box-row-label">{row.label}</span>
              {row.detail && <span className="scene-box-row-detail">{row.detail}</span>}
              {row.signs && row.signs.length > 0 && <Signs signs={row.signs} />}
              {row.marks && row.marks.length > 0 && (
                <span className="scene-box-row-marks" title={row.marks.join(', ')}>
                  {row.marks.map((markName) => (
                    <span key={markName} data-mark={markName} className="scene-box-row-mark">
                      {markName === 'required' || markName === 'unsafe'
                        ? '!'
                        : markName === 'immutable'
                          ? '◆'
                          : markName === 'auto'
                            ? '⟳'
                            : '◎'}
                    </span>
                  ))}
                </span>
              )}
            </div>
          ))}
          {model.moreRows > 0 && (
            <div className="scene-box-row scene-box-row-more">+{model.moreRows} more</div>
          )}
        </div>
      )}
      {model.rules.length > 0 && (
        <div
          className="scene-rules"
          style={{ top: model.rulesTop, height: model.height - model.rulesTop }}
        >
          {groupsOf(model.rules).map((group) => (
            <div
              key={group.y}
              aria-hidden
              className="scene-rule-group"
              data-rule-group={group.group}
              style={{ top: group.y - 2, height: group.height + 4 }}
            />
          ))}
          {model.rules.map((placed) => (
            <RuleRowView
              key={placed.rule.id}
              placed={placed}
              selectedId={selectedId}
              hoveredId={hoveredId}
              litRules={litRules}
              litNames={litNames}
              onToggleFold={onToggleFold}
            />
          ))}
        </div>
      )}
      {!leaving && (
        <Pin domainId={anchor.domainId ?? domainId} anchor={anchor.ref} excerpt={anchor.excerpt} />
      )}
    </div>
  )
})

/** The groups a card's rows read in, each where its rows stand: what draws them apart. */
function groupsOf(rules: readonly PlacedRule[]): { group: RuleGroup; y: number; height: number }[] {
  const groups: { group: RuleGroup; y: number; height: number }[] = []
  for (const placed of rules) {
    const last = groups.at(-1)
    if (last?.group === placed.group) last.height = placed.y + placed.height - last.y
    else groups.push({ group: placed.group, y: placed.y, height: placed.height })
  }
  return groups
}

/**
 * A rule row, in the hue of the operation it decides (a constraint's in its own). One rule of an
 * operation starts with its mark — whom it admits, hollow where the Kernel's default applies —
 * and what it decides, its phrase beside them; a fold or a constraint says what it is above its
 * phrase, a fold with its chevron, which opens or shuts it for good, and the marks of the rules
 * it holds. A row a fold holds starts with its mark. The functions a row guards follow its
 * phrase, each selecting its function. It selects itself, and lights what it walks under the
 * pointer. Where phrases no longer read (`data-glance` on the canvas) it is a block in its hue,
 * hollow where nothing is written, its marks then what it decides and how much.
 */
function RuleRowView({
  placed,
  selectedId,
  hoveredId,
  litRules,
  litNames,
  onToggleFold,
}: {
  placed: PlacedRule
  selectedId?: string
  hoveredId?: string | null
  /** lit with the selection, dim beside it, or neither while nothing of the card is lit */
  litRules?: ReadonlySet<string> | null
  litNames?: ReadonlySet<string> | null
  onToggleFold?: (fold: string) => void
}) {
  const { rule, depth, lines, inline } = placed
  const names = litNamesOf(placed, selectedId, litNames)
  // what "+N" counts: lit with them when the selection lights any
  const counted = (rule.names ?? []).filter((name) => !names?.shown.includes(name))
  const indent = depth === 1 ? RULE.indent : 0
  const fold = rule.holds !== undefined
  const drawnOpen = rule.open === true || rule.raised === true
  const lit = litRules ? litRules.has(rule.id) : undefined
  const partly = fold && rule.rows?.some((row) => row.unwritten)
  const { lead } = placed
  const mark = rule.marks?.[0]
  return (
    <div
      data-rule-id={rule.id}
      data-select-id={rule.id}
      data-hover-id={rule.id}
      data-rule-tone={rule.tone}
      data-rule-op={rule.op}
      data-inline={inline || undefined}
      data-lead={lead > 0 || undefined}
      data-unwritten={rule.unwritten || undefined}
      data-unread={rule.unread || undefined}
      data-partly={partly || undefined}
      data-fold={fold ? (drawnOpen ? 'open' : 'shut') : undefined}
      data-kept={rule.open || undefined}
      data-depth={depth}
      data-selected={rule.id === selectedId || undefined}
      data-hovered={rule.id === hoveredId || undefined}
      data-lit={lit === undefined ? undefined : lit ? 'lit' : 'dim'}
      data-emphasis={rule.emphasis}
      title={rule.title}
      className="scene-rule"
      style={
        {
          top: placed.y,
          height: placed.height,
          left: CARD.padX - 4 + indent,
          right: CARD.padX - 4,
          padding: `${RULE.padY}px 4px`,
          ...(rule.op ? { '--rule-tone': TONE_COLOR[rule.op] } : {}),
        } as CSSProperties
      }
    >
      {lead > 0 && (
        <span className="scene-rule-lead" style={{ width: lead, height: RULE.lineH }}>
          {mark && <RuleMark mark={mark} title={null} />}
          {inline && <span className="scene-rule-label">{rule.label}</span>}
        </span>
      )}
      {depth === 0 && !inline && (
        <span className="scene-rule-head" style={{ height: RULE.labelH }}>
          {fold && (
            <button
              type="button"
              className="scene-rule-chevron"
              aria-expanded={drawnOpen}
              aria-label={`${rule.open ? 'Shut' : 'Keep open'} ${rule.label}`}
              title={
                rule.open
                  ? 'Shut this fold'
                  : rule.raised
                    ? 'Keep this fold open: the map makes room for it'
                    : 'Open this fold: the map makes room for it'
              }
              data-fold-toggle={rule.id}
              onPointerDown={stopPointer}
              onClick={(event) => {
                event.stopPropagation()
                onToggleFold?.(rule.id)
              }}
            >
              {drawnOpen ? <ChevronDown /> : <ChevronRight />}
            </button>
          )}
          {rule.tone === 'what' ? <ConstraintMark /> : <RuleMarks marks={rule.marks ?? []} />}
          <span className="scene-rule-label">{rule.label}</span>
        </span>
      )}
      <span className="scene-rule-body">
        <span className="scene-rule-text">
          {lines.map((line, index) => (
            <span key={index} className="scene-rule-line" style={{ height: RULE.lineH }}>
              {line}
            </span>
          ))}
        </span>
        {names && (
          <span className="scene-rule-names" style={{ height: RULE.namesH }}>
            {names.shown.map((name, index) => (
              <span key={name.id}>
                {index > 0 && ', '}
                <span
                  className="scene-rule-name"
                  data-rule-name={name.id}
                  data-select-id={name.id}
                  data-selected={name.id === selectedId || undefined}
                  data-lit={litNames?.has(name.rule) || undefined}
                  title={`Select ${name.label}`}
                >
                  {name.label}
                </span>
              </span>
            ))}
            {names.more > 0 && (
              <>
                {', '}
                <span
                  className="scene-rule-more"
                  data-lit={counted.some((name) => litNames?.has(name.rule)) || undefined}
                  title={counted.map((name) => name.label).join(', ')}
                >
                  +{names.more}
                </span>
              </>
            )}
          </span>
        )}
      </span>
      <span className="scene-rule-glance" aria-hidden>
        {(rule.marks?.length ?? 0) > 0 && (
          <RuleMarks
            marks={rule.marks!.slice(0, RULE.glanceMarks)}
            className="scene-glance-marks"
          />
        )}
        <span className="scene-glance-words">{placed.glance}</span>
      </span>
    </div>
  )
}

/**
 * The names a row draws: as placed, unless the selection lights one that is counted in its
 * "+N" — then that one is drawn by name, in place of names that are not lit.
 */
function litNamesOf(
  placed: PlacedRule,
  selectedId: string | undefined,
  litNames: ReadonlySet<string> | null | undefined,
): PlacedRule['names'] {
  const { names, rule } = placed
  if (!names || names.more === 0 || !rule.names) return names
  const wanted = (name: { id: string; rule: string }) =>
    name.id === selectedId || litNames?.has(name.rule) === true
  const hidden = rule.names.filter((name) => !names.shown.includes(name))
  return hidden.some(wanted) ? namesIn(rule.names, names.room, measureText, wanted) : names
}

/** A member row selects, lights and peeks its node, as its card would. */
function memberRowData(
  row: SceneRow,
  selectedId: string | undefined,
  hoveredId: string | null | undefined,
  litNodes: ReadonlySet<string> | null | undefined,
) {
  return {
    'data-member': '',
    'data-hover-id': row.id,
    'data-select-id': row.id,
    'data-selected': row.id === selectedId || undefined,
    'data-hovered': row.id === hoveredId || undefined,
    'data-emphasis': litNodes ? (litNodes.has(row.id) ? 'lit' : 'dim') : undefined,
  }
}

/** Marks read at a glance on a row: a dot per verb, a glyph, a short word; each says itself on hover. */
function Signs({ signs }: { signs: readonly SceneSign[] }) {
  return (
    <span className="scene-row-signs">
      {signs.map((sign, index) => {
        const color = TONE_COLOR[sign.tone ?? 'muted']
        const key = `${sign.shape}:${sign.glyph ?? sign.text ?? sign.tone ?? ''}:${index}`
        if (sign.shape === 'dot')
          return (
            <span
              key={key}
              title={sign.title}
              className="scene-row-sign-dot"
              style={{ background: color }}
            />
          )
        if (sign.shape === 'glyph' && sign.glyph) {
          const Glyph = GLYPHS[sign.glyph]
          return (
            <span
              key={key}
              title={sign.title}
              className="scene-row-sign-glyph"
              data-count={sign.text === undefined ? undefined : ''}
              style={{ color }}
            >
              <Glyph className="h-[11px] w-[11px]" />
              {sign.text}
            </span>
          )
        }
        return (
          <span key={key} title={sign.title} className="scene-row-sign-text" style={{ color }}>
            {sign.text}
          </span>
        )
      })}
    </span>
  )
}

const FAR_ZOOM = 1.6

/**
 * From afar a card is its name — and the name of the frame it is drawn instead of — at one size
 * on every card (`FAR_ZOOM`, smaller only for a name the card cannot hold at it), then as many
 * counts as fit beside it. The header keeps its height: the card is the size the layout gave it.
 */
function headerOf(
  model: BoxModel,
  far: boolean,
  toggle: boolean,
  height: number,
): { style: CSSProperties; counts: number } {
  if (!far) return { style: { height }, counts: model.counts.length }
  // The zoom scales the header's padding with its text, so both are measured together.
  const room = model.width - CARD.border * 2
  let used =
    CARD.padX * 2 +
    (toggle ? CARD.icon + CARD.gap : 0) +
    measureText(model.title, 'title') +
    (model.frame ? 6 + measureText(model.frame, 'sublabel') : 0)
  const zoom = Math.min(FAR_ZOOM, Math.max(1, room / used))
  let counts = 0
  for (const count of model.counts) {
    used += CARD.countGap + CARD.countIcon + 3 + measureText(String(count.value), 'count')
    if (used * zoom > room) break
    counts += 1
  }
  return { style: { height: height / zoom, zoom }, counts }
}

/** A card's badge: its label in its tone's chip colours, outlined where it is declared only. */
export function BadgeView({ badge }: { badge: SceneBadge }) {
  return (
    <span
      title={badge.title}
      data-badge={badge.label}
      data-badge-tone={badge.tone}
      data-outline={badge.outline || undefined}
      className={cn('scene-box-badge', TONE_CHIP[badge.tone ?? 'muted'])}
    >
      {badge.label}
    </span>
  )
}

const stopPointer = (event: ReactPointerEvent) => event.stopPropagation()

/**
 * A junction: where the ends that accept the same several boxes meet, before fanning out
 * to each. A small, quiet mark; its title names the set and the links through it.
 */
export const JunctionView = memo(function JunctionView({
  junction,
  rect,
  title,
  emphasis,
  hovered,
  leaving,
}: {
  junction: JunctionBox
  rect: Rect
  /** the set it stands for and the links through it, read on hover */
  title: string
  emphasis: Emphasis
  hovered?: boolean
  leaving?: boolean
}) {
  return (
    <button
      type="button"
      data-box-id={junction.id}
      data-box-kind="junction"
      data-junction-id={junction.id}
      data-hover-id={junction.id}
      data-emphasis={emphasis}
      data-hovered={hovered || undefined}
      data-leaving={leaving || undefined}
      aria-label={title}
      title={title}
      className="scene-junction"
      style={{
        transform: `translate(${rect.x}px, ${rect.y}px)`,
        width: rect.width,
        height: rect.height,
      }}
      onPointerDown={stopPointer}
    />
  )
})

/** A band's heading: what its column holds, read quietly above it. */
export const BandHeading = memo(function BandHeading({
  label,
  rect,
}: {
  label: string
  rect: Rect
}) {
  return (
    <div
      className="scene-band"
      style={{
        transform: `translate(${rect.x}px, ${rect.y}px)`,
        width: rect.width,
        height: rect.height,
      }}
    >
      {label}
    </div>
  )
})

/** The room a region's header keeps around its name: padding, the fold toggle, gaps. */
const REGION_HEADER_ROOM = 6 + 8 + 20 + 4 + 4

/** Whether a region's marks fit on its header beside its name, as wide as the frame is. */
function fitsBeside(group: SceneGroup, width: number): boolean {
  const marks = (group.badges ?? []).reduce(
    (total, badge) =>
      total + measureText(badge.label, 'badge') + CARD.badgePadX * 2 + CARD.badgeGap,
    0,
  )
  return REGION_HEADER_ROOM + measureText(group.label, 'regionName') + marks <= width
}

/** A module region: a soft frame around its cards, its name on top. */
export const RegionView = memo(function RegionView({
  group,
  rect,
  members,
  tier,
  emphasis,
  selected,
  domainId,
  onToggleGroup,
}: {
  group: SceneGroup
  rect: Rect
  members: number
  tier: Tier
  emphasis: Emphasis
  selected: boolean
  domainId: string
  onToggleGroup: (group: string) => void
}) {
  const tint = group.hue === undefined ? undefined : moduleTint(group.hue)
  // One card needs no frame around it: its module's name above it says the same.
  const framed = members > 1
  const anchor = group.anchor ?? group.id
  return (
    <div
      data-region-id={group.id}
      data-hover-id={group.id}
      data-emphasis={emphasis}
      data-framed={framed || undefined}
      data-selected={selected || undefined}
      {...commentTarget(anchor, group.label)}
      className="scene-region"
      style={
        {
          transform: `translate(${rect.x}px, ${rect.y}px)`,
          width: rect.width,
          height: rect.height,
          '--region-surface': tint?.surface ?? 'var(--color-muted)',
          '--region-border': selected
            ? (tint?.mark ?? 'var(--color-primary)')
            : (tint?.border ?? 'var(--color-border)'),
          '--region-text': tint?.text ?? 'var(--color-muted-foreground)',
        } as CSSProperties
      }
    >
      <div
        className="scene-region-header"
        data-region-header={group.id}
        style={{ height: REGION_HEADER }}
      >
        <button
          type="button"
          aria-label={`Collapse ${group.label}`}
          title="Collapse the module"
          className="scene-region-toggle"
          onPointerDown={stopPointer}
          onClick={(event) => {
            event.stopPropagation()
            onToggleGroup(group.id)
          }}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <span className={cn('scene-region-label', tier === 'far' && 'scene-region-label-far')}>
          {group.label}
        </span>
        {tier !== 'far' && group.badges && group.badges.length > 0 && (
          <span
            className="scene-region-badges"
            // Beside its name when they fit; else on the frame's edge, never cut.
            data-on-edge={fitsBeside(group, rect.width) ? undefined : true}
          >
            {group.badges.map((badge) => (
              <BadgeView key={badge.label} badge={badge} />
            ))}
          </span>
        )}
      </div>
      <Pin domainId={domainId} anchor={anchor} excerpt={group.label} />
    </div>
  )
})
