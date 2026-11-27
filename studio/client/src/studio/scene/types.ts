/**
 * The Scene: what a lens hands the canvas.
 *
 * A Scene names the things to draw and how they relate — never where they go, how they
 * read at a given zoom, or which lens produced them. Every id is the selection target of
 * what it draws (`class.Issue`, `function.Issue.archive`, `module.modules/fleet`), so a
 * thing keeps its identity, and its place on screen, when the lens changes.
 *
 * A lens is a projector: a pure function from a schema bundle to a Scene. The canvas
 * applies one grammar to every Scene — every link is drawn, union ends meet a junction,
 * parallel links bundle, groups collapse — so a new lens is written as a projector and
 * nothing else. A Scene may ask for ribbons instead of routes (`lines`), quiet headings over
 * its columns (`bands`), and groups drawn as one box of rows (`SceneGroup.members`).
 */

import type { DomainAnatomy, StudioSchemaBundle } from '@shared/contracts/schema'

export interface Scene {
  /** Equal keys guarantee equal content: the canvas lays a Scene out again only when it changes. */
  key: string
  nodes: SceneNode[]
  links: SceneLink[]
  groups: SceneGroup[]
  /** What the projector left out, counted, so the canvas can say so instead of dropping it. */
  folded: SceneFold[]
  /** What the canvas says while it draws no box: what the lens found none of. */
  empty?: string
  /**
   * What a closed trunk of several links reads: `count` says how many relationships it
   * carries (the default); `labels` names what its links say, as long as that stays short.
   */
  trunkLabel?: 'count' | 'labels'
  /**
   * How links travel at rest. `routes` (the default): each link is drawn, bundled into a
   * trunk with the links between the same two ends, along orthogonal routes. `ribbons`: the
   * links between two boxes of different columns travel as one ribbon — a smooth band as
   * thick as the nodes it carries (bounded), one stripe per tone — and each is drawn alone,
   * as a curve named on its line, only while lit or under the pointer.
   */
  lines?: 'routes' | 'ribbons'
  /**
   * Which way links lead, in a Scene of routes: `across` (the default), left to right; `either`,
   * across or down, whichever lays the Scene out with the shorter longer side — a map read whole
   * in one pane then reads at the largest zoom it can, few layers or many cards to a layer.
   */
  flow?: 'across' | 'either'
  /** Quiet headings over columns: what each column holds. */
  bands?: SceneBand[]
  /**
   * How links draw at rest: `regular` (the default), or `thin`, for a Scene whose cards say
   * what it is about and whose links matter where something walks them: thinner and lighter
   * until lit.
   */
  lineWeight?: 'regular' | 'thin'
  /**
   * The Domains drawn whole beside each other, each a framed area: the canvas's own first. Every
   * node, group and link then names its area; without areas the Scene is one Domain's.
   */
  areas?: SceneArea[]
  /**
   * What the Index lists instead of the nodes and links: entries of their own, grouped by
   * these groups (never drawn on the canvas), each a selection target.
   */
  index?: {
    groups: SceneGroup[]
    entries: SceneEntry[]
    /** What the Index says while it lists none: what the lens found none of. */
    empty?: string
    /** Kinds listed behind their chip, left out until it is pressed. */
    hiddenKinds?: string[]
  }
}

/** One Domain drawn whole on a canvas that draws several: a framed area holding its parts. */
export interface SceneArea {
  /** `area.<origin>`: what its parts name as their area, and what places it */
  id: string
  origin: string
  /** The Domain's id in the Studio: its comments are filed there, and it opens there. */
  domainId: string
  /** The Domain's name. */
  label: string
  /** Read after the name, quieter: the version the Domain declares. */
  version?: string
  /** The canvas's own Domain. */
  home?: boolean
  /** The Domain's hue on this canvas: its frame, its name and its Index row wear it. */
  hue: number
}

/** A thing the Index lists that the canvas draws no box for: a Policy, a constraint's form. */
export interface SceneEntry {
  /** The selection target, e.g. `policy.<key>`. */
  id: string
  /** The comment anchor, when it is not the id (`SceneNode.anchor`). */
  anchor?: string
  kind: string
  label: string
  /** Read after the label, quieter, e.g. `12 places`. */
  sublabel?: string
  /** The id of the index group it is listed under. */
  group?: string
  tone?: SceneTone
  icon?: SceneIcon
  keywords?: string[]
  /** For a Policy, the operations it decides, in slot order: what the Index reads after it. */
  ops?: RuleOp[]
  /**
   * For a Policy: what its own rule walks and its steps, as a site's rule carries them
   * (`SceneRuleRef`). Selected, the map draws this walk, not that of a site it sits on.
   */
  walk?: string[]
  steps?: SceneWalkStep[]
}

/** A heading over one column, read above its topmost box. */
export interface SceneBand {
  column: number
  label: string
}

/**
 * The semantic hue a mark wears; each maps to a token of the stylesheet. A kind's hue
 * (`node` … `muted`) shows on a link once it is lit; a verb's hue (`create` … `warning`) is
 * what the link says, so it shows at rest; a rule's hue (`who`, `what`) says which question
 * a rule answers, everywhere it is read — on a link, as the mark before its name.
 */
export type SceneTone = KindTone | VerbTone | StandingTone | RuleTone | ObserveTone

export type KindTone = 'node' | 'edge' | 'view' | 'core' | 'fn' | 'muted'

/** What a function does to what it reaches. */
export type VerbTone = 'create' | 'update' | 'delete' | 'transition' | 'link' | 'unlink' | 'call'

/**
 * Where something stands: `warning` when it breaks, needs action, or would repeat on another
 * attempt; `success` when it holds.
 */
export type StandingTone = 'warning' | 'success'

/** A Policy, which reads its caller, or a constraint, which never does. */
export type RuleTone = 'who' | 'what'

/** The operations that observe a Node or an Edge, each in its own hue; writes wear their verb's. */
export type ObserveTone = 'read' | 'traverse'

/**
 * What a rule decides: an operation on a Class or relationship, or calling a callable. Each is
 * the tone it wears: observing in its own hue, writing and calling in its verb's.
 */
export type RuleOp = ObserveTone | 'create' | 'update' | 'delete' | 'call'

/**
 * Whom a rule admits, as its mark says: a Policy decides (`policy`); every caller (`open`); any
 * signed-in caller (`signed-in`); only Root, the Domain and holders of the operation's
 * capability (`holders`); only Root and the Domain (`closed`); or the reader cannot tell
 * (`unread`).
 */
export type RuleAdmission = 'policy' | 'open' | 'signed-in' | 'holders' | 'closed' | 'unread'

/** A rule's mark: whom it admits, in the hue of the operation; hollow where nothing is written. */
export interface SceneRuleMark {
  op: RuleOp
  admits: RuleAdmission
  /** Nothing is written: the Kernel's default admits whom it says. */
  unwritten?: boolean
}

/** The hues a link's line and name wear at rest: the verbs, and where something stands. */
export const HUED_TONES: ReadonlySet<SceneTone> = new Set<VerbTone | StandingTone>([
  'create',
  'update',
  'delete',
  'transition',
  'link',
  'unlink',
  'call',
  'warning',
  'success',
])

/** A built-in pictogram, for nodes whose definition carries no icon of its own. */
export type SceneGlyph =
  | 'class'
  | 'relationship'
  | 'function'
  | 'mutation'
  | 'integration'
  | 'identity'
  | 'view'
  | 'module'
  | 'policy'
  | 'constraint'
  | 'precondition'
  | 'scenario'

export interface SceneIcon {
  /** Authored SVG markup; the renderer sanitizes it. Wins over `glyph`. */
  svg?: string
  glyph?: SceneGlyph
}

export interface SceneNode {
  /** The selection target, stable across lenses. */
  id: string
  /** The comment anchor, when it is not the id. */
  anchor?: string
  /**
   * The Domain a comment on the node is filed under, on a canvas that draws several (the
   * Workspace map); else the canvas's own.
   */
  anchorDomain?: string
  /** What the node is (`class`, `function`); the Index names and filters by it. */
  kind: string
  /** A card holds counts, badges and rows; a pill is its name alone, a step between cards. */
  shape: 'card' | 'pill'
  label: string
  /** Read after the label, quieter: another Domain's name, a qualifier. */
  sublabel?: string
  /** The id of the SceneGroup the node belongs to. */
  group?: string
  /** The id of the SceneArea the node belongs to, on a canvas of several Domains. */
  area?: string
  /**
   * The column the node stands in, counted with the flow: the layout keeps every node left
   * of any in a higher column. A Scene that ranks one node ranks all of them.
   */
  column?: number
  icon?: SceneIcon
  tone?: SceneTone
  /** Read at every zoom. */
  counts?: SceneCount[]
  /** Read from the middle zoom on: `extends FleetResource`, a role. */
  badges?: SceneBadge[]
  /**
   * The node stands for something the Scene holds none of — a Class no Node of a dataset is
   * of — so a mark on it has a place: drawn quiet, its border dashed.
   */
  absent?: boolean
  /**
   * What the node says of itself, in its author's words: read under its header and badges from
   * the middle zoom on, wrapped on a few lines and never cut in a word's middle.
   */
  note?: string
  /** Read when near: the node's members. */
  rows?: SceneRow[]
  /**
   * The rules that sit on the node, one row each, read from the middle zoom on: a row
   * selects itself, and lights what it walks.
   */
  rules?: SceneRule[]
  /** What happens to the node, counted, in words; read from the middle zoom on. */
  tallies?: SceneTally[]
  /**
   * Marks read at a glance — on the node's row, when its group draws its members as rows: a
   * dot per verb, a plug, a short word.
   */
  signs?: SceneSign[]
  /**
   * The group or node the layout keeps it level with: a Class beside the module that
   * declares it. A hint, weighed above any link.
   */
  beside?: string
  /** Extra words the Index search matches. */
  keywords?: string[]
}

/** A phrase that counts, e.g. `updated by 11`. */
export interface SceneTally {
  /** the phrase as read, its count included */
  label: string
  value: number
  tone?: SceneTone
}

/** A small mark; its title says it in words. */
export interface SceneSign {
  /** a dot in the tone's hue, a pictogram, or a short word */
  shape: 'dot' | 'glyph' | 'text'
  glyph?: SceneGlyph
  /** the word a `text` sign reads; after a `glyph` sign's pictogram, the count it marks */
  text?: string
  tone?: SceneTone
  /** read on hover */
  title: string
}

export interface SceneCount {
  /** The plural noun, e.g. `properties`. */
  label: string
  value: number
}

export interface SceneBadge {
  label: string
  tone?: SceneTone
  /** Read on hover. */
  title?: string
  /** Shown only when near, for badges that would crowd a card from afar. */
  near?: boolean
  /** Drawn as an outline: what would happen, as declared, not what is. */
  outline?: boolean
}

export interface SceneRow {
  id: string
  /** The comment anchor of the member the row stands for. */
  anchor?: string
  /** The Domain a comment on the row is filed under, when not the canvas's (`SceneNode`). */
  anchorDomain?: string
  label: string
  /** Read after the label, e.g. the property's type. */
  detail?: string
  /** Short flags, e.g. `required`, `immutable`, `auto`, `state`. */
  marks?: string[]
  signs?: SceneSign[]
}

/**
 * A rule a node or link carries, as selecting it lights: itself, and what its pattern walks.
 * A link lights its rules without drawing them; a card draws each as a row (`SceneRule`).
 */
export interface SceneRuleRef {
  /** The selection target: the rule's site (`class.Host#read`), or a fold's own id. */
  id: string
  /** Other selection ids said alike, lit with it: `class.Host#traverse`. */
  also?: string[]
  tone: RuleTone
  /** The operation it decides, whose hue it wears; none for a constraint or a fold of them. */
  op?: RuleOp
  /**
   * Whom it admits, as the mark it starts with: one for a rule; for a fold, each different one
   * its rows hold, in the order they read.
   */
  marks?: SceneRuleMark[]
  /** The scene ids of the Classes and relationships it reads, in the order it walks them. */
  walk?: string[]
  /**
   * Its walk's steps as the map numbers them: each beside what it numbers — a relationship it
   * follows, the Class it starts at or goes to — with the number the rule's steps give it.
   */
  steps?: SceneWalkStep[]
}

/** A step of a rule's walk, numbered beside a Class or relationship of the map. */
export interface SceneWalkStep {
  id: string
  number: number
}

/**
 * One rule as a card reads it: what it decides, then the rule as a short phrase. A fold
 * stands for several rules (`12 functions · 4 rules`) and holds a row for each: drawn while
 * the reader keeps it `open`, or while a selection raises its card.
 */
export interface SceneRule extends SceneRuleRef {
  /** What it decides: `read`, `create`, `calls`, `constraints`; none for a row a fold holds. */
  label: string
  /** The rule as a phrase, wrapped on the card and never cut in its middle. */
  text: string
  /** The whole sentence, read on hover. */
  title: string
  /** Nothing is written: `text` says what applies instead, read quietly. */
  unwritten?: boolean
  /** Written, but with no reading: `text` says why, read quietly. */
  unread?: boolean
  /** A fold's rows, one per rule it holds. */
  rows?: SceneRule[]
  /** For a fold: the rules it stands for, counted, whether open or not. */
  holds?: string[]
  /** A fold the reader opened: its rows are laid out with its card. */
  open?: boolean
  /** A fold a selection opened: its rows are drawn over the map, and its card laid out shut. */
  raised?: boolean
  /** The functions a call rule guards, named after its phrase. */
  names?: SceneRuleName[]
  /** How an option has the row read: lit, or dim beside the lit ones. */
  emphasis?: 'lit' | 'dim'
}

/**
 * A function a row's rule guards: what selecting its name selects (`function.Host.rename`),
 * its own call rule (`class.Host.method.rename#call`), lit where that rule is, and its name.
 */
export interface SceneRuleName {
  id: string
  rule: string
  label: string
}

export interface SceneLink {
  /** The selection target, stable across lenses. */
  id: string
  /** The comment anchor, when it is not the id. */
  anchor?: string
  /** The selection target a click opens, for a link that is not one itself (`extends`). */
  opens?: string
  /** What the link is (`relationship`, `extends`); the Index names and filters by it. */
  kind: string
  /** What the line says. */
  label: string
  /**
   * What the link is called where it is read apart from the cards it joins (the Index, a
   * comment): `Admin → Issues`, for a line that says only what its ends do not. Left out, the
   * label is its name.
   */
  name?: string
  /** The group that declares the link — the Index lists it there. */
  group?: string
  /** The area whose Domain declares the link, on a canvas of several Domains. */
  area?: string
  /** The Domain a comment on the link is filed under, when not the canvas's (`SceneNode`). */
  anchorDomain?: string
  from: SceneEnd
  to: SceneEnd
  /** A directed link reads from `from` to `to`; the canvas draws an arrowhead at `to`. */
  directed: boolean
  tone?: SceneTone
  dashed?: boolean
  /** Constraints the link carries, e.g. `no self`, `acyclic`. */
  marks?: string[]
  /**
   * The link reaches a hub most of the scene reaches: drawn faint and unnamed at rest, in
   * full once lit, so the hub's many lines never drown the rest.
   */
  ambient?: boolean
  /** Drawn only while lit: a link that would crowd the scene at rest (a call between rows). */
  latent?: boolean
  /** The rules that sit on the link: not drawn, but selecting one lights what it walks. */
  rules?: SceneRuleRef[]
}

/** What a link is called apart from the cards it joins: its name, else what its line says. */
export function linkName(link: Pick<SceneLink, 'name' | 'label'>): string {
  return link.name ?? link.label
}

/**
 * One end of a link: the role it plays and everything it accepts. An end that accepts
 * exactly one drawn node is attached to it; an end that accepts several meets a junction
 * that fans out to each of them. Every end names at least one scene node: a link is
 * always drawn.
 */
export interface SceneEnd {
  /** The end's name, e.g. `principal`. */
  role?: string
  /** The scene nodes the end accepts. */
  nodes: string[]
  /** The end's multiplicity, e.g. `0..1`. */
  count?: string
  /**
   * The end restricts (`restrict`, as the Kernel defines or derives it): deleting a Node there is
   * refused while it has the link, unless the same change deletes the link.
   */
  restricts?: true
}

export interface SceneGroup {
  /** The selection target, e.g. `module.modules/fleet`. */
  id: string
  /** The comment anchor, when it is not the id. */
  anchor?: string
  /** The Domain a comment on the group is filed under, when not the canvas's (`SceneNode`). */
  anchorDomain?: string
  /** The id of the SceneArea the group belongs to, on a canvas of several Domains. */
  area?: string
  label: string
  /** The group's hue on the colour wheel. */
  hue?: number
  /**
   * How its members are drawn: `boxes` (the default), each its own box inside the group's
   * frame; `rows`, one row each of the group's single box — open, the rows show; collapsed,
   * only its header. The box stays where it is either way.
   */
  members?: 'boxes' | 'rows'
  /** Read after the label, quieter, e.g. `12 functions`. */
  caption?: string
  /**
   * Marks on the whole group, read beside its name from the middle zoom on — on its frame, on
   * its box when collapsed, on its one card when it holds one: what a selection says of it.
   */
  badges?: SceneBadge[]
}

export interface SceneFold {
  /** What was left out, e.g. `Functions`. */
  label: string
  count: number
  /** Where it is read instead, or why it is not drawn. */
  reason: string
  /** The lens that draws it, when another one does: the fold switches to it. */
  lens?: string
}

/** Names as a label lists them: the first `most` in order, any more counted. */
export function listed(names: readonly string[], most = 3): string {
  if (names.length <= most) return names.join(' · ')
  return `${names.slice(0, most - 1).join(' · ')} +${names.length - most + 1}`
}

/** A toggle a lens offers; the canvas stores its value and hands it back to the projector. */
/** What a lens option's toggle pictures: what turning it on draws. */
export type LensOptionIcon =
  | 'domains'
  | 'inheritance'
  | 'unwritten'
  | 'mutations'
  | 'reads'
  | 'calls'

export interface LensOption {
  id: string
  label: string
  /** Read on hover. */
  description: string
  default: boolean
  /** The toggle's pictogram; no two options of one lens share one. */
  icon: LensOptionIcon
}

export type LensOptions = Readonly<Record<string, boolean>>

/**
 * What a new lens implements: a pure, deterministic projection of one Domain's bundle.
 * `focus` is what the reader selected, for a lens that draws more around it; equal focus
 * keys give equal Scenes. `anatomy` is what the Domain's sources say beside its Schema (its
 * Views' code), for a lens that reads it; a Scene that reads it keys on what it read.
 */
export type Projector = (
  bundle: StudioSchemaBundle,
  options: LensOptions,
  focus?: string,
  anatomy?: DomainAnatomy,
) => Scene
