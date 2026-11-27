/**
 * The size of every box, from its content alone. Layout reserves exactly what the card
 * renders: the renderer lays each part out at the offsets computed here, so a box never
 * grows past the place the layout gave it.
 *
 * Text is measured through a `TextMeasure`, the canvas's own in the browser and a stand-in
 * in tests; either way the same content always measures the same.
 */

import type {
  RuleOp,
  SceneBadge,
  SceneNode,
  SceneRow,
  SceneRule,
  SceneRuleName,
  SceneSign,
  SceneTally,
} from '../scene/types'
import type { Rect } from './geometry'

import { type Box, namesGroup, titledAs } from '../scene/arrange'

/** `compact` reads from afar and the middle; `full` adds what a box holds when near. */
export type Detail = 'compact' | 'full'

export type FontRole =
  | 'title'
  | 'sublabel'
  | 'count'
  | 'badge'
  | 'row'
  | 'rowDetail'
  | 'linkLabel'
  | 'linkMarks'
  | 'regionName'
  | 'ruleLabel'
  | 'ruleText'
  | 'ruleGlance'
  | 'ruleGlanceInner'

export const FONTS: Record<FontRole, { weight: number; size: number; mono?: boolean }> = {
  title: { weight: 600, size: 13 },
  sublabel: { weight: 400, size: 11 },
  count: { weight: 500, size: 11 },
  badge: { weight: 500, size: 10.5 },
  row: { weight: 400, size: 11.5, mono: true },
  rowDetail: { weight: 400, size: 10.5 },
  linkLabel: { weight: 500, size: 10.5 },
  linkMarks: { weight: 400, size: 9.5 },
  regionName: { weight: 600, size: 11.5 },
  ruleLabel: { weight: 500, size: 10.5, mono: true },
  ruleText: { weight: 400, size: 12 },
  /** a row read as a mark, at the glance tier; a fold's row in `ruleGlanceInner` */
  ruleGlance: { weight: 600, size: 15, mono: true },
  ruleGlanceInner: { weight: 600, size: 13, mono: true },
}

export type TextMeasure = (text: string, font: FontRole) => number

/** A deterministic stand-in: a fixed advance per character of the font size. */
export const estimateText: TextMeasure = (text, font) =>
  Math.ceil(text.length * FONTS[font].size * (FONTS[font].mono ? 0.62 : 0.56))

export const CARD = {
  radius: 10,
  /** the card's border, on each side */
  border: 1,
  padX: 12,
  headerH: 40,
  icon: 16,
  gap: 8,
  minW: 176,
  maxW: 320,
  badgeRowH: 22,
  badgePadX: 6,
  badgeGap: 4,
  rowH: 20,
  rowsPad: 6,
  maxRows: 14,
  countIcon: 11,
  countGap: 10,
  /** a tally: its dot, the gap after it, its padding, its height, and the line it takes */
  tallyDot: 6,
  tallyPadX: 6,
  tallyGap: 4,
  tallyH: 18,
  tallyLineH: 20,
  /** the lines a card's tallies wrap into below its header, at most, room allowing */
  tallyLines: 2,
  /** the widest a card grows to read its tallies on its header line */
  tallyBesideW: 440,
  /** a sign: a dot's width, a glyph's, a word's padding, and the gap between two */
  signDot: 8,
  signGlyph: 13,
  /** between a pictogram and the count after it */
  signCountGap: 2,
  signPadX: 4,
  signGap: 3,
  /** the most rows a group of rows shows */
  maxMemberRows: 60,
} as const

/**
 * A card's note (`SceneNode.note`): its author's words under its header and badges, measured
 * as a rule's phrase is, on at most `lines` lines.
 */
export const NOTE = {
  /** the least width a card with a note takes, so it reads on few lines */
  width: 264,
  lineH: 16,
  lines: 3,
  /** the room above its first line, under the header; under badges, `afterBadges` */
  top: 2,
  afterBadges: 2,
  /** the room below its last line */
  bottom: 10,
} as const

/**
 * A card's rule rows. A row that decides an operation starts with its mark and what it decides,
 * its phrase beside them on at most `lines` lines, then the functions it guards on one line; a
 * fold or a constraint says what it is above its phrase. A row a fold holds stands in, and has
 * no label: its mark, where it has one, then its phrase.
 */
export const RULE = {
  /** the least width a card with rules takes, so its phrases read on few lines */
  width: 296,
  /** the room above and below the rows */
  pad: 6,
  /** the room above and below one row */
  padY: 3,
  labelH: 15,
  lineH: 16,
  /** the line naming the functions a rule guards */
  namesH: 15,
  /** the most lines a phrase takes; past them it ends with "…" */
  lines: 3,
  /** how far a fold's rows stand in */
  indent: 14,
  /** a fold's chevron, before its label */
  chevron: 12,
  gap: 6,
  /** what a mark's words leave of the row's text room, at the glance tier (see `.scene-rule-glance`) */
  glanceInset: 12,
  /** a row's mark (`.rule-mark`) and the room after it */
  mark: 16,
  markGap: 6,
  /** the room between what an operation's row says it decides and its phrase */
  labelGap: 10,
  /** the room between two groups of rows (`RuleGroup`) */
  groupGap: 6,
  /** a mark at the glance tier, the room after it, and the most a fold draws */
  glanceMark: 18,
  glanceMarkGap: 5,
  glanceMarks: 3,
} as const

/** Whether a rule row says what it decides beside its phrase: one rule of an operation. */
export const inlineRule = (rule: SceneRule, depth: 0 | 1) =>
  depth === 0 && rule.op !== undefined && rule.holds === undefined

/** What an operation's row can say it decides: its column is as wide as the widest of them. */
const OP_LABELS: readonly RuleOp[] = ['read', 'traverse', 'create', 'update', 'delete', 'call']

/** The column what an operation's row decides is said in, as `measure` reads its words. */
export const opColumn = (measure: TextMeasure) =>
  Math.max(...OP_LABELS.map((label) => measure(label, 'ruleLabel'))) + RULE.labelGap

/** The room a row's mark and what it decides take before its phrase, `column` for the latter. */
function ruleLead(rule: SceneRule, depth: 0 | 1, column: number): number {
  if (inlineRule(rule, depth)) return RULE.mark + RULE.markGap + column
  return depth === 1 && rule.marks?.length ? RULE.mark + RULE.markGap : 0
}

/**
 * The groups a card's rows read in, each set apart: what observes (`read`, `traverse`), what
 * writes (`create`, `update`, `delete`), who calls, what must hold. A fold's rows are its own.
 */
export type RuleGroup = 'observe' | 'write' | 'call' | 'hold'

export function ruleGroupOf(rule: SceneRule): RuleGroup {
  if (rule.op === 'read' || rule.op === 'traverse') return 'observe'
  if (rule.op === 'create' || rule.op === 'update' || rule.op === 'delete') return 'write'
  return rule.op === 'call' ? 'call' : 'hold'
}

/** The room a row's marks take at the glance tier, before its words. */
function glanceLead(rule: SceneRule): number {
  const count = Math.min(rule.marks?.length ?? 0, RULE.glanceMarks)
  return count === 0 ? 0 : count * RULE.glanceMark + (count - 1) * 2 + RULE.glanceMarkGap
}

/**
 * The rendered size, in pixels, at which a row's phrase reads (`show`), and below which it
 * no longer does (`hide`): under it a row is a mark in its tone, which says at a glance where
 * something is written and where nothing is. The gap between them keeps a zoom resting at the
 * edge from flickering.
 */
export const LEGIBLE_TEXT = { show: 9, hide: 8.5 } as const

/** The Studio's secondary text, in px: what the Index's second lines read at. */
export const SECONDARY_TEXT = 11

/**
 * The most the camera zooms in on its own, to fit a scene or frame a selection: where a card's
 * chips and a line's name — the smallest text a compact card and its lines carry — read as the
 * Studio's secondary text. A small scene reads at that size, not blown up past it.
 */
export const READING_ZOOM = SECONDARY_TEXT / Math.min(FONTS.badge.size, FONTS.linkLabel.size)

/** Whether rule phrases read at `zoom`, given whether they read before it. */
export const rulesLegible = (zoom: number, before: boolean) =>
  FONTS.ruleText.size * zoom >= (before ? LEGIBLE_TEXT.hide : LEGIBLE_TEXT.show)

/**
 * How many times its size a link name read at every zoom is drawn at `zoom`, so it reads at
 * `LEGIBLE_TEXT.show` at least: 1 where it already does, else in steps of a quarter octave, so a
 * zoom places it again only where it crosses a step.
 */
export function spokenScale(zoom: number): number {
  const exact = LEGIBLE_TEXT.show / (FONTS.linkLabel.size * zoom)
  return exact <= 1 ? 1 : 2 ** (Math.ceil(Math.log2(exact) * 4) / 4)
}

/** A pill: one line, its name and qualifier, between the cards it links. */
export const PILL = {
  height: 30,
  padX: 10,
  minW: 96,
  maxW: 260,
} as const

/** A tally where the card draws it, from the card's top-left. */
export interface PlacedTally extends SceneTally {
  x: number
  y: number
  width: number
}

/** A rule row where the card draws it, from the top of its rules: its phrase in lines. */
export interface PlacedRule {
  rule: SceneRule
  /** 1 for a row a fold holds: it stands in, with no label */
  depth: 0 | 1
  /** what it decides is said beside its phrase, after its mark (`inlineRule`), not above it */
  inline: boolean
  y: number
  height: number
  lines: string[]
  /** the functions it guards on the line after its phrase, `room` wide: those that fit, then how many more */
  names?: RuleNames
  /** what the row says as a mark, at the glance tier, within its width */
  glance: string
  /** the room its mark and what it decides take before its phrase */
  lead: number
  /** the group it reads in, set apart from the rows of the next */
  group: RuleGroup
}

/** A box's parts and where each one sits, in world units from the box's top-left. */
export interface BoxModel {
  width: number
  height: number
  title: string
  sublabel?: string
  /**
   * The name of the frame this box is drawn instead of — a lone Class of another Domain, a lone
   * member of a module — when its title does not say it: it reads at every zoom.
   */
  frame?: string
  counts: { label: string; value: number }[]
  tallies: PlacedTally[]
  badges: SceneBadge[]
  badgesTop: number
  /** the node's note in lines, read from the middle zoom on */
  note?: string[]
  noteTop?: number
  rows: SceneRow[]
  /** the rows are the group's member nodes: each one selects its node */
  memberRows: boolean
  /** rows left out past `CARD.maxRows` */
  moreRows: number
  rowsTop: number
  /** the node's rules, read from the middle zoom on */
  rules: PlacedRule[]
  rulesTop: number
}

/** A sign's width, as the row draws it. */
export function signWidth(sign: SceneSign, measure: TextMeasure): number {
  if (sign.shape === 'dot') return CARD.signDot
  if (sign.shape === 'glyph')
    return CARD.signGlyph + (sign.text ? measure(sign.text, 'badge') + CARD.signCountGap : 0)
  return measure(sign.text ?? '', 'badge') + CARD.signPadX * 2
}

export function signsWidth(signs: readonly SceneSign[] | undefined, measure: TextMeasure): number {
  if (!signs || signs.length === 0) return 0
  return (
    signs.reduce((total, sign) => total + signWidth(sign, measure), 0) +
    CARD.signGap * (signs.length - 1)
  )
}

const tallyWidth = (tally: SceneTally, measure: TextMeasure) =>
  Math.ceil(measure(tally.label, 'badge')) + CARD.tallyDot + CARD.tallyGap + CARD.tallyPadX * 2

/** How many lines tallies this wide take, wrapped `room` wide. */
function tallyLinesIn(widths: readonly number[], room: number): number {
  let lines = 1
  let x = 0
  for (const width of widths) {
    if (x > 0 && x + width > room) {
      lines += 1
      x = 0
    }
    x += width + CARD.badgeGap
  }
  return lines
}

/** The least room tallies this wide need to wrap into `lines` lines at most. */
function tallyRoom(widths: readonly number[], lines: number): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + CARD.badgeGap * (widths.length - 1)
  let room = Math.max(...widths)
  while (room < total && tallyLinesIn(widths, room) > lines) room += 4
  return Math.min(room, total)
}

/** Tallies wrapped into lines `room` wide, each where it is drawn below `top`. */
function placeTallies(
  tallies: readonly SceneTally[],
  room: number,
  top: number,
  measure: TextMeasure,
): PlacedTally[] {
  const placed: PlacedTally[] = []
  let x = 0
  let line = 0
  for (const tally of tallies) {
    const width = tallyWidth(tally, measure)
    if (x > 0 && x + width > room) {
      x = 0
      line += 1
    }
    placed.push({ ...tally, x: CARD.padX + x, y: top + line * CARD.tallyLineH, width })
    x += width + CARD.badgeGap
  }
  return placed
}

/** Where a header's label ends, from the card's left, inside its border. */
function labelEnd(title: string, sublabel: string | undefined, measure: TextMeasure): number {
  let end = CARD.padX + CARD.icon + CARD.gap + measure(title, 'title')
  if (sublabel) end += 6 + measure(sublabel, 'sublabel')
  return end
}

function countsWidth(counts: { value: number }[], measure: TextMeasure): number {
  return counts.reduce(
    (total, count) =>
      total + CARD.countGap + CARD.countIcon + 3 + measure(String(count.value), 'count'),
    0,
  )
}

function headerWidth(
  title: string,
  sublabel: string | undefined,
  counts: { value: number }[],
  measure: TextMeasure,
): number {
  return labelEnd(title, sublabel, measure) + countsWidth(counts, measure) + CARD.padX
}

function rowWidth(row: SceneRow, measure: TextMeasure): number {
  return (
    CARD.padX * 2 +
    measure(row.label, 'row') +
    CARD.gap +
    Math.min(140, measure(row.detail ?? '', 'rowDetail')) +
    (row.marks?.length ?? 0) * 14 +
    (row.signs && row.signs.length > 0 ? CARD.gap + signsWidth(row.signs, measure) : 0)
  )
}

/** A junction's side: a small mark, sized so a fan line meets it at its centre. */
export const JUNCTION_SIZE = 12

const EMPTY_PARTS = {
  counts: [],
  tallies: [],
  badges: [],
  badgesTop: 0,
  rows: [],
  memberRows: false,
  moreRows: 0,
  rowsTop: 0,
  rules: [],
  rulesTop: 0,
} as const satisfies Partial<BoxModel>

/**
 * A box's model at one detail. `width`, when given, is the width the box takes — its
 * column's — and what wraps inside it wraps to that width.
 */
export function boxModel(box: Box, detail: Detail, measure: TextMeasure, width?: number): BoxModel {
  if (box.kind === 'junction') {
    return { width: JUNCTION_SIZE, height: JUNCTION_SIZE, title: 'one of', ...EMPTY_PARTS }
  }
  const node = box.kind === 'node' ? box.node : undefined
  const title = box.kind === 'node' ? box.node.label : box.group.label
  const rowsGroup = box.kind === 'group' && box.group.members === 'rows'
  const caption = box.kind === 'node' ? box.caption : undefined
  // A lone box says its frame's name beside its own qualifier, unless that already says it.
  const sublabel =
    [
      node?.sublabel,
      caption !== undefined && node && !namesGroup(caption, node) ? caption : undefined,
    ]
      .filter(Boolean)
      .join(' · ') || (rowsGroup ? box.group.caption : undefined)
  const frame = caption !== undefined && node && !titledAs(caption, node) ? caption : undefined
  if (node?.shape === 'pill') {
    let natural = PILL.padX * 2 + CARD.icon + CARD.gap + measure(title, 'title')
    if (sublabel) natural += 6 + measure(sublabel, 'sublabel')
    if (node.signs && node.signs.length > 0) natural += CARD.gap + signsWidth(node.signs, measure)
    return {
      width:
        width ?? Math.round(Math.min(PILL.maxW, Math.max(PILL.minW, natural + CARD.border * 2))),
      height: PILL.height,
      title,
      ...(sublabel ? { sublabel } : {}),
      ...(frame ? { frame } : {}),
      ...EMPTY_PARTS,
    }
  }
  // A group of rows says what it holds in its caption; a collapsed group of boxes counts it.
  const counts =
    box.kind === 'node'
      ? (box.node.counts ?? [])
      : rowsGroup
        ? []
        : [
            { label: 'nodes', value: box.members.length },
            ...(box.inner.length > 0 ? [{ label: 'links inside', value: box.inner.length }] : []),
          ]
  // A group's marks read on its box when collapsed, and on its one card when it holds one.
  const badges = [
    ...(box.kind === 'node' ? [...(box.captionBadges ?? []), ...(box.node.badges ?? [])] : []),
    ...(box.kind === 'group' ? (box.group.badges ?? []) : []),
  ].filter((badge) => detail === 'full' || !badge.near)
  // A group of rows shows its members whenever it is open; a card its own rows when near.
  const allRows =
    box.kind === 'group'
      ? box.open
        ? (box.rows ?? []).map(memberRow)
        : []
      : detail === 'full'
        ? (node?.rows ?? [])
        : []
  const rows = allRows.slice(0, box.kind === 'group' ? CARD.maxMemberRows : CARD.maxRows)
  const moreRows = allRows.length - rows.length
  const tallies = node?.tallies ?? []

  let natural = headerWidth(title, sublabel, counts, measure)
  if (badges.length > 0) {
    const badgesWidth =
      CARD.padX * 2 +
      badges.reduce(
        (total, badge) => total + measure(badge.label, 'badge') + CARD.badgePadX * 2,
        0,
      ) +
      CARD.badgeGap * (badges.length - 1)
    natural = Math.max(natural, badgesWidth)
  }
  // Tallies read on the header line when the card can grow wide enough for them; else they
  // wrap below it, the card as wide as keeps them to `CARD.tallyLines` lines.
  const tallyWidths = tallies.map((tally) => tallyWidth(tally, measure))
  const label = labelEnd(title, sublabel, measure)
  const besideWidth =
    tallies.length > 0
      ? label +
        CARD.gap +
        tallyWidths.reduce((sum, one) => sum + one, 0) +
        CARD.badgeGap * (tallies.length - 1) +
        countsWidth(counts, measure) +
        CARD.padX
      : 0
  let most: number = CARD.maxW
  if (tallies.length > 0 && besideWidth <= CARD.tallyBesideW) {
    natural = Math.max(natural, besideWidth)
    most = Math.max(most, besideWidth + CARD.border * 2)
  } else if (tallies.length > 0) {
    natural = Math.max(natural, CARD.padX * 2 + tallyRoom(tallyWidths, CARD.tallyLines))
  }
  for (const row of rows) natural = Math.max(natural, rowWidth(row, measure))
  const rules = node?.rules ?? []
  if (rules.length > 0) natural = Math.max(natural, RULE.width)
  if (node?.note) natural = Math.max(natural, NOTE.width)
  // Content is measured inside the card's border; the card is that plus the border.
  const boxWidth =
    width ?? Math.round(Math.min(most, Math.max(CARD.minW, natural + CARD.border * 2)))

  let height = CARD.headerH
  const beside = tallies.length > 0 && besideWidth <= boxWidth - CARD.border * 2
  let placedTallies: PlacedTally[]
  if (beside) {
    let x = label + CARD.gap
    placedTallies = tallies.map((tally, index) => {
      const placed = {
        ...tally,
        x,
        y: (CARD.headerH - CARD.tallyH) / 2,
        width: tallyWidths[index]!,
      }
      x += tallyWidths[index]! + CARD.badgeGap
      return placed
    })
  } else {
    placedTallies = placeTallies(
      tallies,
      boxWidth - CARD.border * 2 - CARD.padX * 2,
      height - 6,
      measure,
    )
    if (placedTallies.length > 0) height += placedTallies.at(-1)!.y - (height - 6) + CARD.tallyLineH
  }
  const badgesTop = height - 6
  if (badges.length > 0) height += CARD.badgeRowH
  const noteTop = height + (badges.length > 0 ? NOTE.afterBadges : NOTE.top)
  const note = node?.note
    ? fitLines(node.note, boxWidth - CARD.border * 2 - CARD.padX * 2, NOTE.lines, measure)
    : []
  if (note.length > 0) height = noteTop + note.length * NOTE.lineH + NOTE.bottom
  const rowsTop = height
  if (rows.length > 0)
    height += CARD.rowsPad * 2 + (rows.length + (moreRows > 0 ? 1 : 0)) * CARD.rowH
  const rulesTop = height
  const placedRules = placeRules(rules, boxWidth - CARD.border * 2 - CARD.padX * 2, measure)
  if (placedRules.length > 0) {
    const last = placedRules.at(-1)!
    height += last.y + last.height + RULE.pad
  }

  return {
    width: boxWidth,
    height: Math.round(height),
    title,
    ...(sublabel ? { sublabel } : {}),
    ...(frame ? { frame } : {}),
    counts,
    tallies: placedTallies,
    badges,
    badgesTop,
    ...(note.length > 0 ? { note, noteTop } : {}),
    rows,
    memberRows: rowsGroup,
    moreRows,
    rowsTop,
    rules: placedRules,
    rulesTop,
  }
}

/**
 * Rule rows `room` wide, each at its offset from the rows' top; an open fold's rows after it.
 * No two rows of a card read the same: rows whose lines would, though their rules differ,
 * read whole; rows whose marks would read from where they part.
 */
function placeRules(rules: readonly SceneRule[], room: number, measure: TextMeasure): PlacedRule[] {
  const drawn: { rule: SceneRule; depth: 0 | 1 }[] = []
  for (const rule of rules) {
    drawn.push({ rule, depth: 0 })
    if (rule.open || rule.raised)
      for (const row of rule.rows ?? []) drawn.push({ rule: row, depth: 1 })
  }
  const widthOf = (depth: 0 | 1) => room - (depth === 1 ? RULE.indent : 0)
  const column = opColumn(measure)
  const textRoom = (rule: SceneRule, depth: 0 | 1) => widthOf(depth) - ruleLead(rule, depth, column)
  // a fold's rows read in its group
  const groups: RuleGroup[] = []
  drawn.forEach(({ rule, depth }, index) =>
    groups.push(depth === 1 ? groups[index - 1]! : ruleGroupOf(rule)),
  )
  const fitted = drawn.map(({ rule, depth }) =>
    fitLines(rule.text, textRoom(rule, depth), RULE.lines, measure),
  )
  const said = new Map<string, Set<string>>()
  fitted.forEach((lines, index) => {
    const key = lines.join('\n')
    said.set(key, new Set([...(said.get(key) ?? []), drawn[index]!.rule.text]))
  })
  const glanceRoom = (rule: SceneRule, depth: 0 | 1) =>
    widthOf(depth) - RULE.glanceInset - glanceLead(rule)
  const marks = drawn.map(({ rule, depth }) =>
    glanceIn(rule, depth, glanceRoom(rule, depth), measure),
  )
  const placed: PlacedRule[] = []
  let y = RULE.pad
  drawn.forEach(({ rule, depth }, index) => {
    if (index > 0 && groups[index] !== groups[index - 1]) y += RULE.groupGap
    const clash = said.get(fitted[index]!.join('\n'))!.size > 1
    const lines = clash ? wrapped(rule.text, textRoom(rule, depth), measure) : fitted[index]!
    const names =
      rule.names && rule.names.length > 0
        ? namesIn(rule.names, textRoom(rule, depth), measure)
        : undefined
    const inline = inlineRule(rule, depth)
    const height =
      RULE.padY * 2 +
      (depth === 0 && !inline ? RULE.labelH : 0) +
      lines.length * RULE.lineH +
      (names ? RULE.namesH : 0)
    const alike = drawn.filter(
      (other, at) =>
        at !== index && marks[at] === marks[index] && saying(other) !== saying(drawn[index]!),
    )
    const glance =
      alike.length > 0
        ? glanceIn(rule, depth, glanceRoom(rule, depth), measure, alike.map(saying))
        : marks[index]!
    placed.push({
      rule,
      depth,
      inline,
      y,
      height,
      lines,
      ...(names ? { names } : {}),
      glance,
      lead: ruleLead(rule, depth, column),
      group: groups[index]!,
    })
    y += height
  })
  return placed
}

/** What a row says as a mark, longest first: a head, then what it counts after it. */
function sayingsOf(rule: SceneRule, depth: 0 | 1): [head: string, tail: string][] {
  const names = rule.names ?? []
  const more = names.length > 1 ? ` +${names.length - 1}` : ''
  // A function's row says it is a call where room allows: a Method may be named as an
  // operation is (`create`).
  if (depth === 1)
    return names.length === 0
      ? [[rule.text, '']]
      : [
          [`call · ${names[0]!.label}`, more],
          [names[0]!.label, more],
        ]
  if (rule.holds) {
    const count = rule.holds.length
    const unwritten = (rule.rows ?? [])
      .filter((row) => row.unwritten)
      .reduce((total, row) => total + Math.max(1, row.names?.length ?? 0), 0)
    const what = rule.tone === 'what' ? `${count} constraints` : `${count} calls`
    return unwritten > 0
      ? [
          [`${what} · ${unwritten} unwritten`, ''],
          [what, ''],
        ]
      : [[what, '']]
  }
  if (names.length > 0)
    return [
      [`call · ${names[0]!.label}`, more],
      [names[0]!.label, more],
    ]
  return [[rule.label, '']]
}

/** The head of a row's shortest saying: what its mark is cut from. */
const saying = ({ rule, depth }: { rule: SceneRule; depth: 0 | 1 }) =>
  sayingsOf(rule, depth).at(-1)![0]

/**
 * What a row says as a mark, `room` wide: what it decides and how much (`12 calls · 1
 * unwritten`, `4 constraints`), or the first function it guards (`call · rename +2`). Where that
 * is too wide, its shorter saying (`rename +2`), then that saying's head cut, ending with "…"
 * before what it counts. A mark that would read like those of `apart` — the heads of other
 * rows of its card — keeps where it parts from them: it reads from the earliest word that
 * leaves that place in its room, after "…".
 */
export function glanceIn(
  rule: SceneRule,
  depth: 0 | 1,
  room: number,
  measure: TextMeasure,
  apart: readonly string[] = [],
): string {
  const font: FontRole = depth === 1 ? 'ruleGlanceInner' : 'ruleGlance'
  const sayings = sayingsOf(rule, depth)
  for (const [head, tail] of sayings) if (measure(head + tail, font) <= room) return head + tail
  const [head, tail] = sayings.at(-1)!
  const parts = Math.max(0, ...apart.map((other) => partsAt(head, other)))
  const starts = [0, ...[...head.matchAll(/ (?!· )(?=\S)/gu)].map((space) => space.index + 1)]
  const cut = (start: number, kept: number) =>
    `${start > 0 ? '…' : ''}${head.slice(start, kept).trimEnd()}${kept < head.length ? '…' : ''}${tail}`
  let best = ''
  for (const start of starts.filter((each) => each <= parts)) {
    let kept = head.length
    while (kept > Math.max(start + 1, parts + 1) && measure(cut(start, kept), font) > room)
      kept -= 1
    best = cut(start, kept)
    if (measure(best, font) <= room) return best
  }
  return best
}

/** Where `head` parts from `other`: the first character they do not share. */
function partsAt(head: string, other: string): number {
  let at = 0
  while (at < head.length && at < other.length && head[at] === other[at]) at += 1
  return Math.min(at, head.length - 1)
}

/** The names a rule row draws on its line: those shown, how many more, the line's width. */
export interface RuleNames {
  shown: SceneRuleName[]
  more: number
  room: number
}

/**
 * The names that fit on one line `room` wide, in order, and how many more there are. Names
 * `wanted` — those the selection lights — are drawn before any other, so a lit one never hides
 * in what is counted; the line keeps its height whichever it draws.
 */
export function namesIn(
  names: readonly SceneRuleName[],
  room: number,
  measure: TextMeasure,
  wanted: (name: SceneRuleName) => boolean = () => false,
): RuleNames {
  const first = [...names.filter(wanted), ...names.filter((name) => !wanted(name))]
  const shownOf = (count: number) => {
    const picked = new Set(first.slice(0, count))
    return names.filter((name) => picked.has(name))
  }
  const width = (count: number) =>
    measure(
      shownOf(count)
        .map((name) => name.label)
        .join(', ') + (count < names.length ? `, +${names.length - count}` : ''),
      'ruleLabel',
    )
  let count = names.length
  while (count > 1 && width(count) > room) count -= 1
  return { shown: shownOf(count), more: names.length - count, room }
}

/** Words wrapped into lines `room` wide, each line as many words as fit. */
function wrapped(text: string, room: number, measure: TextMeasure): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && measure(next, 'ruleText') > room) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/**
 * A phrase in at most `most` lines `room` wide: whole where it fits, else its first lines,
 * the last ending with "…" after the words that still fit. It is never cut in its middle.
 */
export function fitLines(text: string, room: number, most: number, measure: TextMeasure): string[] {
  const whole = wrapped(text, room, measure)
  if (whole.length <= most) return whole
  const lines = whole.slice(0, most)
  const words = lines[most - 1]!.split(' ')
  const ended = () => `${words.join(' ').replace(/[\s,;:]+$/u, '')}…`
  while (words.length > 1 && measure(ended(), 'ruleText') > room) words.pop()
  lines[most - 1] = ended()
  return lines
}

/** A member node as its group's row: its name, its qualifier, its signs. */
function memberRow(node: SceneNode): SceneRow {
  return {
    id: node.id,
    ...(node.anchor ? { anchor: node.anchor } : {}),
    ...(node.anchorDomain ? { anchorDomain: node.anchorDomain } : {}),
    label: node.label,
    ...(node.sublabel ? { detail: node.sublabel } : {}),
    ...(node.signs && node.signs.length > 0 ? { signs: node.signs } : {}),
  }
}

/** The rect of `node`'s row in the box of the group that draws it as one, when it shows. */
export function rowRect(
  model: BoxModel | undefined,
  rect: Rect | undefined,
  node: string,
): Rect | undefined {
  if (!model?.memberRows || !rect) return undefined
  const index = model.rows.findIndex((row) => row.id === node)
  if (index < 0) return undefined
  return {
    x: rect.x,
    y: rect.y + CARD.border * 2 + model.rowsTop + CARD.rowsPad + index * CARD.rowH,
    width: rect.width,
    height: CARD.rowH,
  }
}
