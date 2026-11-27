/**
 * The Scene canvas: draws whatever Scene it is given, with one grammar for every lens.
 *
 * - The camera moves by writing one transform; React renders again only when the zoom
 *   crosses a tier, so panning and zooming cost no layout.
 * - A new frame (another tier, a collapsed module, another lens) keeps the box the reader
 *   was looking at in place — the selection, else the box in view nearest the pointer;
 *   with none in view it fits. A reader who saw the whole map and turns to another question
 *   (another lens, nothing selected) sees the whole of the new one: it fits. Shared boxes
 *   glide to their new place, others fade.
 * - Selecting lights the neighbourhood and dims the rest; hovering opens trunks and lights
 *   fans without dimming anything. A junction opens a menu of its links and its set.
 * - In a Scene of ribbons, a ribbon steps back while the lines it carries are drawn alone:
 *   a node's own lines show while the pointer is on its row and while it is selected, and a
 *   box under the pointer brings its ribbons forward.
 * - A new selection, or the same one in another lens, ends with its neighbourhood framed at
 *   a readable zoom: all of it when it fits, else the selection and what is nearest it. A
 *   neighbourhood already shown whole at that zoom keeps the camera: no card moves.
 * - Every box, junction and module (by its name) drags; its lines and labels follow live.
 *   Letting go records where it rests — beside, never over, another box — and nothing else
 *   moves. "Auto-arrange" forgets what was placed in the lens.
 * - Keys: `F` isolates the selection's neighbourhood, `Esc` backs out, `.` fits, arrows
 *   walk to the nearest box that way.
 */

import './scene-canvas.css'
import { Focus, LayoutGrid, Maximize, Minus, Plus, X } from 'lucide-react'
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useUI } from '@/lib/store'
import { anchorData, targetSurface } from '@/lib/targets'
import { cn } from '@/lib/utils'

import type { Arrangement, JunctionBox } from '../scene/arrange'
import type { Scene } from '../scene/types'
import type { Point, Rect } from './geometry'

import { CanvasIconToggle, CanvasToolbar } from '../../schema-studio/canvas-toolbar'
import { isJunction } from '../scene/arrange'
import {
  litTogether,
  type LitLinks,
  neighbourhood,
  type Neighbourhood,
  standingFor,
} from '../scene/focus'
import {
  cardWithFoldsRaised,
  foldsOpenedBy,
  type OwnWalk,
  ruleMarks,
  ownWalkOf,
  ruleOwner,
  rulePlaces,
  rulesLit,
} from '../scene/rules'
import { linkName } from '../scene/types'
import { useStage } from '../stage/store'
import { type Back, type CameraCause, cameraFor } from './camera'
import { bandHeadings } from './columns'
import { type Emphasis, faintLines, type LineFocus, nameDrawn } from './emphasis'
import {
  anchorShift,
  type Frame,
  inView,
  nearestBox,
  rectOf,
  selectionOf,
  shiftFrame,
} from './frame'
import { drawIn, focusLabels, focusView } from './framing'
import {
  closedLabels,
  curveLabels,
  memberRoutes,
  openLabels,
  type PlacedLabel,
  spokenLabels,
} from './labels'
import { LabelsLayer, LinksLayer } from './links'
import { measureText } from './measure'
import { type BoxModel, boxModel, READING_ZOOM, rulesLegible, spokenScale } from './metrics'
import { OffFramePointers } from './off-frame-pointers'
import { BandHeading, BoxView, JunctionView, RegionView } from './parts'
import { pinPlacement, type Pins, settleDrop } from './pins'
import { pointing } from './pointer'
import { drawnAlone } from './ribbons'
import { walkSteps } from './steps'
import { useCanvas } from './store'
import { TONE_COLOR } from './tones'
import { useFrame } from './use-frame'
import {
  between,
  fitViewport,
  type Insets,
  revealRect,
  shownSize,
  type Tier,
  tierFor,
  toWorld,
  type Viewport,
  visibleWorld,
  zoomAbout,
} from './viewport'
import { type Direction, walk } from './walk'

export interface CanvasOption {
  id: string
  label: string
  description: string
  value: boolean
  icon: ReactNode
}

export interface SceneCanvasProps {
  scene: Scene
  arrangement: Arrangement
  domainId: string
  /** the selected scene id */
  selected?: string
  /** what stands for a selection this scene does not draw: lit as the selection would be */
  lights?: readonly string[]
  /** what a panel points at, as scene ids: while any is set it is lit instead of the
   *  selection's neighbourhood, and the selection itself stays (see `Spotlight`) */
  spotlight?: readonly string[]
  /** which links the spotlight lights: those among what it lights (the default), or only those
   *  it names — the Edges that prove a verdict */
  spotlightLinks?: LitLinks
  /**
   * a walk a panel reads beside the map, as scene ids in walking order: lit with whatever else
   * is, each step numbered beside what it stands at by the panel's own numbers
   */
  walk?: OwnWalk
  /** what the Index filter keeps, as scene ids, while it filters: the rest steps back */
  filter?: readonly string[]
  /** a scene id to bring into view, once */
  revealTarget?: string | null
  /** the id `F` isolated, when the scene is an isolated one */
  isolated?: string
  /** room kept clear of floating chrome when fitting */
  insets: Insets
  options?: readonly CanvasOption[]
  onOption?: (id: string, value: boolean) => void
  /** where the reader placed boxes, by box id */
  pins: Pins
  /** records boxes where the reader let them rest */
  onPlace: (pins: Pins) => void
  /** returns the scene to its automatic layout; absent while nothing is placed */
  onAutoArrange?: () => void
  /** every frame the canvas comes to show */
  onFrame?: (frame: Frame) => void
  onSelect: (id: string | undefined) => void
  onRevealed: () => void
  onToggleGroup: (group: string) => void
  /** opens or shuts a fold of a card's rules for good: the map makes room for it */
  onToggleFold?: (fold: string) => void
  onIsolate: (id: string | null) => void
  /** switches to the lens a fold names, where what it folds is read */
  onLens?: (lens: string) => void
  /**
   * Changes when what the reader looks at changes — the lens, the selection: the next frame
   * drawing the selection frames its neighbourhood.
   */
  frameToken?: string
  /**
   * The lens the canvas draws: a frame laid for another one is a lens entered, framed by the
   * camera's rule (`cameraFor`). None: the canvas draws one lens.
   */
  lens?: string
}

/** What the next frame does to the camera: keep one box still, or fit the whole. */
type Intent = { kind: 'fit' } | { kind: 'anchor'; id: string }

/** A drag of placed boxes in progress. */
interface Placing {
  /** the boxes moved */
  ids: string[]
  /** the frame they were dragged from */
  origin: Frame
  /** every box's corner as the drag began */
  corners: ReadonlyMap<string, Point>
  /** how far the dragged boxes have moved, in world units */
  by: Point
  /** the painted frame a layout waits for */
  frame: number | null
}

/** The drag's placement: the dragged boxes moved by `by`, the rest where they stood. */
function placingPlacement(state: Placing, by: Point) {
  const pins = new Map(state.corners)
  for (const id of state.ids) {
    const corner = state.corners.get(id)!
    pins.set(id, { x: corner.x + by.x, y: corner.y + by.y })
  }
  return pinPlacement(state.origin.placement, state.origin.arrangement, pins, { stack: false })
    .placement
}

/** The boxes a press on `target` moves: its box or junction, or a module by its name. */
function gripOf(frame: Frame, target: Element): string[] | undefined {
  const region = target.closest<HTMLElement>('[data-region-header]')?.dataset.regionHeader
  if (region) {
    const members = frame.arrangement.regions
      .find((candidate) => candidate.id === region)
      ?.members.filter((id) => frame.placement.boxes.has(id))
    return members && members.length > 0 ? members : undefined
  }
  const box = target.closest<HTMLElement>('[data-box-id]')?.dataset.boxId
  return box && frame.placement.boxes.has(box) ? [box] : undefined
}

/** Whether any box of `next` stands elsewhere than in `previous`. */
function placementMoved(previous: Frame, next: Frame): boolean {
  for (const [id, rect] of next.placement.boxes) {
    const before = previous.placement.boxes.get(id)
    if (before && (Math.abs(before.x - rect.x) > 0.5 || Math.abs(before.y - rect.y) > 0.5))
      return true
  }
  return false
}

const MOTION_MS = 240
/** How long the camera stays still before what reads the view reads it again. */
const REST_MS = 120
const NO_RULES: readonly string[] = []
const NO_BOXES: ReadonlyMap<string, Rect> = new Map()

/** A pane and the insets over it: what the camera frames into. */
interface Shown {
  pane: { width: number; height: number }
  insets: Insets
}

const sameInsets = (a: Insets, b: Insets) =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left
const ZOOM_STEP = 1.25

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

const ARROWS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

interface Peek {
  trunks: ReadonlySet<string>
  fans: ReadonlySet<string>
  /** links drawn alone while the pointer is on what they leave */
  links: ReadonlySet<string>
  /** ribbons brought forward */
  ribbons: ReadonlySet<string>
}

const NONE: ReadonlySet<string> = new Set()

/** A focus lighting nothing: everything steps back. */
const nothingLit = (): Neighbourhood => ({
  focus: '',
  boxes: new Set(),
  links: new Set(),
  nodes: new Set(),
  trunks: new Set(),
  ribbons: new Set(),
  fans: new Set(),
  regions: new Set(),
  rules: new Set(),
})

/**
 * What hovering opens: a trunk, a junction's fans, or a box's whole neighbourhood — nothing
 * dims. In a Scene of ribbons: a ribbon, or a box's ribbons, come forward; a node drawn as a
 * row draws its own lines.
 */
function peekOf(frame: Frame, hovered: string | null): Peek | null {
  if (!hovered) return null
  const { scene, arrangement } = frame
  // A rule row opens what its rule lights, its walk included.
  if (rulePlaces(scene).has(hovered)) {
    const lit = rulesLit(scene, arrangement, [hovered])
    if (!lit) return null
    return arrangement.lines === 'ribbons'
      ? { trunks: NONE, fans: lit.fans, links: lit.links, ribbons: NONE }
      : { trunks: lit.trunks, fans: lit.fans, links: NONE, ribbons: NONE }
  }
  if (arrangement.lines === 'ribbons') {
    if (arrangement.ribbons.some((ribbon) => ribbon.id === hovered))
      return { trunks: NONE, fans: NONE, links: NONE, ribbons: new Set([hovered]) }
    const box = arrangement.boxes.find((candidate) => candidate.id === hovered)
    if (box) {
      const ribbons = arrangement.ribbons.filter(
        (ribbon) => ribbon.from === box.id || ribbon.to === box.id,
      )
      const fans = arrangement.fans.filter((fan) => fan.junction === box.id || fan.box === box.id)
      return {
        trunks: NONE,
        fans: new Set(fans.map((fan) => fan.id)),
        links: NONE,
        ribbons: new Set(ribbons.map((ribbon) => ribbon.id)),
      }
    }
    const lit = neighbourhood(scene, arrangement, hovered)
    return lit ? { trunks: NONE, fans: lit.fans, links: lit.links, ribbons: NONE } : null
  }
  const trunk = arrangement.trunks.find((candidate) => candidate.id === hovered)
  if (trunk) {
    // A trunk that meets a junction shows where it may lead.
    const fans = arrangement.fans.filter(
      (fan) => fan.junction === trunk.from || fan.junction === trunk.to,
    )
    return {
      trunks: new Set([trunk.id]),
      fans: new Set(fans.map((fan) => fan.id)),
      links: NONE,
      ribbons: NONE,
    }
  }
  const lit = neighbourhood(scene, arrangement, selectionOf(arrangement, hovered))
  return lit ? { trunks: lit.trunks, fans: lit.fans, links: NONE, ribbons: NONE } : null
}

/** What a junction reads on hover: the set it stands for, and the links that meet it. */
function junctionTitle(frame: Frame, junction: JunctionBox): string {
  const boxes = new Map(frame.arrangement.boxes.map((box) => [box.id, box]))
  const names = junction.accepts.map((id) => {
    const box = boxes.get(id)
    if (box?.kind === 'node')
      return box.node.sublabel ? `${box.node.label} (${box.node.sublabel})` : box.node.label
    return box?.kind === 'group' ? box.group.label : id
  })
  const count = junction.links.length
  return `One of ${names.join(', ')} · ${count} ${count === 1 ? 'link' : 'links'}`
}

const sceneHas = (scene: Scene, id: string) =>
  scene.nodes.some((node) => node.id === id) ||
  scene.links.some((link) => link.id === id) ||
  scene.groups.some((group) => group.id === id)

/** The box drawing a scene id: its own, or — for a rule — the box of the card or link it sits on. */
function boxFor(frame: Frame, id: string): string | undefined {
  const { boxOf } = frame.arrangement
  const own = boxOf.get(id)
  if (own) return own
  const owner = ruleOwner(frame.scene, id)
  return owner ? boxOf.get(owner) : undefined
}

export function SceneCanvas({
  scene,
  arrangement,
  domainId,
  selected,
  lights,
  spotlight,
  spotlightLinks = 'among',
  // `walk` is also the keyboard's step to the nearest box
  walk: panelWalk,
  filter,
  revealTarget,
  isolated,
  insets: given,
  options = [],
  onOption,
  pins,
  onPlace,
  onAutoArrange,
  onFrame,
  onSelect,
  onRevealed,
  onToggleGroup,
  onToggleFold,
  onIsolate,
  onLens,
  frameToken,
  lens,
}: SceneCanvasProps) {
  const paneRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const zoomLabelRef = useRef<HTMLSpanElement>(null)
  const viewport = useRef<Viewport>({ x: 0, y: 0, zoom: 1 })
  const tierRef = useRef<Tier>('middle')
  const [tier, setTier] = useState<Tier>('middle')
  /** how many times their size the names read at every zoom are drawn, far (`spokenScale`) */
  const spokenRef = useRef(1)
  const [spoken, setSpoken] = useState(1)
  /** whether rule phrases read at the zoom shown; unknown until the camera first moves */
  const legibleRef = useRef<boolean | null>(null)
  const [pane, setPane] = useState({ width: 0, height: 0 })
  const paneSize = useRef(pane)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const intent = useRef<Intent | null>(null)
  const pendingFit = useRef(false)
  const settle = useRef<number | null>(null)
  const animation = useRef<number | null>(null)
  /** Where the camera is headed: a running animation's end; none while it rests. */
  const aim = useRef<Viewport | null>(null)
  /** Where the camera last showed the whole lens (`cameraFor`'s rest). */
  const rest = useRef<Viewport | null>(null)
  // The stage at the pane's foot covers what framing leaves free: a walk is framed above it.
  const stageCover = useStage((state) => state.cover)
  const insets = useMemo(
    () => (stageCover > given.bottom ? { ...given, bottom: stageCover } : given),
    [given, stageCover],
  )
  const insetsRef = useRef(insets)
  insetsRef.current = insets
  /** Who hears the camera come to rest: what reads the view without rendering the canvas. */
  const restListeners = useRef(new Set<() => void>())
  const restTimer = useRef<number | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const hovered = useCanvas((state) => state.hovered)
  const setHovered = useCanvas((state) => state.setHovered)
  const pointedStep = useCanvas((state) => state.step)

  const ready = useFrame(scene, arrangement, tier === 'near' ? 'full' : 'compact', pins)
  const [shown, setShown] = useState<Frame | null>(null)
  const shownRef = useRef<Frame | null>(null)
  const [leaving, setLeaving] = useState<Frame | null>(null)
  const [moving, setMoving] = useState(false)
  const [junctionMenu, setJunctionMenu] = useState<{
    junction: JunctionBox
    element: Element
  } | null>(null)

  // ── camera ──
  /** Moves the camera; the tier follows `destination` (an animation's end), else `next`. */
  const apply = useCallback((next: Viewport, destination: number = next.zoom) => {
    viewport.current = next
    if (restTimer.current !== null) window.clearTimeout(restTimer.current)
    restTimer.current = window.setTimeout(() => {
      restTimer.current = null
      for (const listener of restListeners.current) listener()
    }, REST_MS)
    const world = worldRef.current
    if (world) world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(next.zoom * 100)}%`
    // Rule rows read as marks where their phrases are too small to read: written on the pane,
    // so it costs no render.
    const legible = rulesLegible(next.zoom, legibleRef.current ?? true)
    if (legible !== legibleRef.current) {
      legibleRef.current = legible
      paneRef.current?.toggleAttribute('data-glance', !legible)
    }
    const nextTier = tierFor(destination, tierRef.current)
    const nextSpoken = nextTier === 'far' ? spokenScale(destination) : 1
    if (nextSpoken !== spokenRef.current) {
      spokenRef.current = nextSpoken
      setSpoken(nextSpoken)
    }
    if (nextTier !== tierRef.current) {
      tierRef.current = nextTier
      // The box in view nearest the pointer stays still while the cards change detail.
      const frame = shownRef.current
      const focus = pointer.current ?? {
        x: paneSize.current.width / 2,
        y: paneSize.current.height / 2,
      }
      const anchor = frame
        ? nearestBox(
            frame.placement,
            toWorld(next, focus),
            inView(frame.placement, visibleWorld(next, paneSize.current)),
          )
        : undefined
      if (anchor) intent.current = { kind: 'anchor', id: anchor }
      setTier(nextTier)
    }
  }, [])

  const stopAnimation = useCallback(() => {
    if (animation.current !== null) cancelAnimationFrame(animation.current)
    animation.current = null
    aim.current = null
  }, [])

  // An animation changes detail once, at its start, for the zoom it ends at: never midway.
  const animateTo = useCallback(
    (target: Viewport) => {
      stopAnimation()
      const from = viewport.current
      const start = performance.now()
      aim.current = target
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / MOTION_MS)
        apply(between(from, target, t), target.zoom)
        animation.current = t < 1 ? requestAnimationFrame(step) : null
        if (t === 1) aim.current = null
      }
      animation.current = requestAnimationFrame(step)
    },
    [apply, stopAnimation],
  )

  const fit = useCallback(
    (animate: boolean) => {
      const frame = shownRef.current
      const size = paneSize.current
      if (!frame || size.width === 0) {
        pendingFit.current = true
        return
      }
      // A fit never lands near (its zoom is at most `READING_ZOOM`), so it frames the compact
      // cards: the full ones ask for them first, and the compact frame fits on arrival.
      if (frame.placement.detail === 'full') {
        intent.current = { kind: 'fit' }
        tierRef.current = 'middle'
        setTier('middle')
        return
      }
      const target = fitViewport(frame.placement.bounds, size, {
        insets: insetsRef.current,
        maxZoom: READING_ZOOM,
      })
      rest.current = target
      if (animate) animateTo(target)
      else {
        stopAnimation()
        apply(target)
      }
    },
    [animateTo, apply, stopAnimation],
  )

  /** Where the camera goes back to when the selection ends; none while it is the reader's. */
  const back = useRef<Back | null>(null)
  /** What the camera last framed (`frameToken`), until the reader moves it by hand. */
  const framedFor = useRef<string | null>(null)
  /** Asks the selection to be framed again, in the room the pane now leaves it. */
  const [reframe, setReframe] = useState(0)
  /** The selection's end, waiting a frame for the room its panel gives back. */
  const releasing = useRef<number | null>(null)
  /** What `cause` does to the camera, by its one rule (`cameraFor`): the move is the caller's. */
  const take = useCallback((cause: CameraCause) => {
    const { move, back: next } = cameraFor(cause, {
      view: aim.current ?? viewport.current,
      pane: paneSize.current,
      insets: insetsRef.current,
      boxes: shownRef.current?.placement.boxes ?? NO_BOXES,
      back: back.current,
      rest: rest.current,
    })
    back.current = next
    return move
  }, [])
  /** Makes the move the camera's rule decides for `cause`. */
  const follow = useCallback(
    (cause: CameraCause) => {
      const move = take(cause)
      if (move.kind === 'go') animateTo(move.to)
      else if (move.kind === 'fit') fit(true)
    },
    [animateTo, fit, take],
  )
  /** The reader moves the camera by hand: it is theirs, and stays where they leave it. */
  const byHand = useCallback(() => {
    if (releasing.current !== null) cancelAnimationFrame(releasing.current)
    releasing.current = null
    framedFor.current = null
    take({ kind: 'hand' })
  }, [take])

  /**
   * A selection in view stays in view as what the pane shows narrows: the pane itself, as an
   * Inspector docks beside it, or its insets, as one floats over it. Measured against where the
   * camera is headed, so a framing still under way counts as in view.
   */
  const keepInView = useCallback(
    (before: Shown, now: Shown) => {
      const frame = shownRef.current
      const id = selectedRef.current
      const was = shownSize(before.pane, before.insets)
      const is = shownSize(now.pane, now.insets)
      if (!frame || !id || is.width === 0 || (is.width >= was.width && is.height >= was.height))
        return
      const rect = rectOf(frame, id)
      const view = aim.current ?? viewport.current
      if (!rect || revealRect(view, rect, before.pane, before.insets) !== view) return
      // Moved for the selection, the camera goes back with it (`cameraFor`).
      follow({ kind: 'reveal', to: revealRect(view, rect, now.pane, now.insets) })
    },
    [follow],
  )
  /** The room the pane leaves the lens changed: at rest, it is shown whole in it again. */
  const roomChanged = useCallback(
    (before: Shown, now: Shown) => {
      if (shownSize(now.pane, now.insets).width === 0) return
      if (take({ kind: 'relaid' }).kind === 'fit') fit(false)
      else keepInView(before, now)
    },
    [fit, keepInView, take],
  )

  useLayoutEffect(() => {
    const element = paneRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const size = { width: entry.contentRect.width, height: entry.contentRect.height }
      const before = paneSize.current
      paneSize.current = size
      setPane(size)
      if (pendingFit.current && size.width > 0) {
        pendingFit.current = false
        fit(false)
        return
      }
      roomChanged(
        { pane: before, insets: insetsRef.current },
        { pane: size, insets: insetsRef.current },
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [fit, roomChanged])

  // New insets — a panel floating over the canvas, or leaving it — keep the selection in what
  // they leave. The pane is read as it now stands: it may have changed in the same commit. The
  // stage rising or going at the pane's foot frames the selection again in what it leaves, while
  // the camera stands where the Studio framed it: a walk is read whole above the stage.
  const insetsBefore = useRef(insets)
  useLayoutEffect(() => {
    const before = insetsBefore.current
    insetsBefore.current = insets
    if (sameInsets(before, insets)) return
    const was = paneSize.current
    const bounds = paneRef.current?.getBoundingClientRect()
    if (bounds && bounds.width > 0)
      paneSize.current = { width: bounds.width, height: bounds.height }
    if (
      before.bottom !== insets.bottom &&
      selectedRef.current !== undefined &&
      framedFor.current !== null &&
      framedFor.current === tokenRef.current
    ) {
      framing.current = framedFor.current
      setReframe((count) => count + 1)
      return
    }
    roomChanged({ pane: was, insets: before }, { pane: paneSize.current, insets })
  }, [insets, roomChanged])

  // ── frames ──
  /** The boxes the reader is dragging, and the frame they were dragged from. */
  const placing = useRef<Placing | null>(null)
  const [dragging, setDragging] = useState(false)
  const lastReady = useRef<Frame | null>(null)
  /** what the reader looked at (`frameToken`) when the frame shown was laid */
  const laidToken = useRef(frameToken)
  /** the lens the frame shown was laid for */
  const laidLens = useRef(lens)

  /** Shared boxes glide to their new place, and the boxes `from` drew fade out. */
  const glide = useCallback((from: Frame | null) => {
    setLeaving(from)
    setMoving(true)
    // The glide ends on its own clock: a selection made meanwhile must not cancel it.
    if (settle.current !== null) window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      settle.current = null
      setLeaving(null)
      setMoving(false)
    }, MOTION_MS)
  }, [])

  useLayoutEffect(() => {
    // While the reader drags, the frame in their hand stands; a new one waits for the drop.
    if (!ready || ready === lastReady.current || dragging) return
    lastReady.current = ready
    const previous = shownRef.current
    const want = intent.current
    intent.current = null
    if (
      previous &&
      previous.arrangement === ready.arrangement &&
      previous.placement.detail === ready.placement.detail
    ) {
      // The same boxes placed anew — where the reader let them go, or back to automatic
      // layout. The camera stays unless asked to fit.
      shownRef.current = ready
      laidToken.current = frameToken
      laidLens.current = lens
      setShown(ready)
      if (placementMoved(previous, ready)) glide(null)
      if (want?.kind === 'fit') fit(true)
      return
    }
    let next = ready
    let refit = !previous || want?.kind === 'fit'
    if (previous && laidLens.current !== lens) {
      // A lens entered: the camera's rule fits it whole, unless it draws the selection carried
      // into it — framed once this frame shows (`framing`), anchored meanwhile.
      const draws = [selected, ...(selected ? (lights ?? []) : [])].some(
        (id) => id !== undefined && rectOf(ready, id) !== undefined,
      )
      if (take({ kind: 'enter', drawsSelection: draws }).kind === 'fit') refit = true
    } else if (previous && !want && take({ kind: 'relaid' }).kind === 'fit') {
      // At rest, the lens laid out anew shows whole again (`cameraFor`).
      refit = true
    }
    if (previous && !refit) {
      // Only a box the reader can see is one they were looking at: anchoring one out of
      // view would carry the new frame out of view with it. None in view, the frame fits.
      const seen = inView(previous.placement, visibleWorld(viewport.current, paneSize.current))
      const kept = (id: string) => ready.placement.boxes.has(id) && seen(id)
      // The whole map in view, no one box was looked at: turned to another question, the
      // reader is shown the whole of it.
      const turned = laidToken.current !== frameToken
      const whole = [...previous.placement.boxes.keys()].every((id) => seen(id))
      const selectedBox = selected ? boxFor(ready, selected) : undefined
      // A selection this scene does not draw keeps what stands for it still instead.
      const standIn = (lights ?? [])
        .map((id) => boxFor(ready, id))
        .find((box) => box !== undefined && kept(box))
      const focus = pointer.current ?? {
        x: paneSize.current.width / 2,
        y: paneSize.current.height / 2,
      }
      const anchor =
        (want?.kind === 'anchor' ? want.id : undefined) ??
        (selectedBox && kept(selectedBox) ? selectedBox : undefined) ??
        standIn ??
        (turned && whole
          ? undefined
          : nearestBox(previous.placement, toWorld(viewport.current, focus), kept))
      const shift = anchor ? anchorShift(previous.placement, ready.placement, anchor) : undefined
      if (shift) next = shiftFrame(ready, shift.x, shift.y)
      else refit = true
    }
    shownRef.current = next
    laidToken.current = frameToken
    laidLens.current = lens
    setShown(next)
    if (previous) {
      glide(previous)
      if (refit) fit(true)
      return
    }
    fit(false)
  }, [dragging, fit, frameToken, glide, lens, lights, ready, selected, take])
  useEffect(
    () => () => {
      if (settle.current !== null) window.clearTimeout(settle.current)
      if (restTimer.current !== null) window.clearTimeout(restTimer.current)
      if (releasing.current !== null) cancelAnimationFrame(releasing.current)
    },
    [],
  )
  const onRest = useCallback((listener: () => void) => {
    restListeners.current.add(listener)
    return () => void restListeners.current.delete(listener)
  }, [])
  const cameraNow = useCallback(
    () => ({ viewport: viewport.current, pane: paneSize.current, insets: insetsRef.current }),
    [],
  )
  // The frame as drawn, the selection's neighbourhood drawn in: where its places lie.
  const drawnRef = useRef<Frame | null>(null)
  /** Brings a place of the selection into view, the camera moving as little as it can. */
  const goTo = useCallback(
    (id: string) => {
      const drawn = drawnRef.current
      const rect = drawn ? rectOf(drawn, id) : undefined
      const view = aim.current ?? viewport.current
      if (rect)
        follow({
          kind: 'reveal',
          to: revealRect(view, rect, paneSize.current, insetsRef.current),
        })
    },
    [follow],
  )
  useEffect(() => {
    if (shown) onFrame?.(shown)
  }, [onFrame, shown])

  // ── focus ──
  const lit = useMemo<Neighbourhood | null>(() => {
    if (!shown) return null
    const { scene: drawn, arrangement: arranged } = shown
    // Rules light their rows and walks; anything else stands for itself.
    const standing = (ids: readonly string[], links?: LitLinks) =>
      rulesLit(drawn, arranged, ids) ?? standingFor(drawn, arranged, ids, links)
    const chosen = (): Neighbourhood | null => {
      if (spotlight && spotlight.length > 0) return standing(spotlight, spotlightLinks)
      // A filter keeping nothing the map draws steps everything back.
      if (filter) return (filter.length > 0 ? standing(filter) : null) ?? nothingLit()
      if (!selected) return null
      // A Policy lights the rows of the sites it sits on, and walks its own rule.
      const own = ownWalkOf(drawn, selected)
      return (
        rulesLit(drawn, arranged, [selected]) ??
        neighbourhood(drawn, arranged, selected) ??
        (own ? rulesLit(drawn, arranged, lights ?? [], own) : null) ??
        (lights && lights.length > 0 ? standing(lights) : null)
      )
    }
    // A panel's walk lights with all of that, its steps numbered as the panel numbers them.
    const walked = panelWalk ? rulesLit(drawn, arranged, [], panelWalk) : null
    return walked?.walk ? litTogether(chosen(), walked) : chosen()
  }, [filter, lights, panelWalk, selected, shown, spotlight, spotlightLinks])
  // The rules a selection lights, whose places the canvas's edge points to past the frame: a
  // rule selected, or those that stand for a selection the map does not draw (a Policy).
  const selectedRules = useMemo(() => {
    if (!shown || !selected) return NO_RULES
    const places = rulePlaces(shown.scene)
    if (places.has(selected)) return [selected]
    const standing = (lights ?? []).filter((id) => places.has(id))
    return standing.length > 0 ? standing : NO_RULES
  }, [lights, selected, shown])
  // The selection whose neighbourhood is drawn in, so the whole of it reads in the pane.
  const [drawnFor, setDrawnFor] = useState<string | null>(null)
  const frame = useMemo(
    () =>
      shown && lit && drawnFor !== null && drawnFor === selected && !spotlight?.length
        ? drawIn(shown, lit, drawnFor, measureText)
        : shown,
    [drawnFor, lit, selected, shown, spotlight],
  )
  useLayoutEffect(() => {
    drawnRef.current = frame
  }, [frame])
  const peek = useMemo(
    () => (frame && hovered !== selected ? peekOf(frame, hovered) : null),
    [frame, hovered, selected],
  )
  const open = useMemo(() => {
    const ids = new Set<string>()
    if (!frame) return ids
    // Near, every trunk opens but a collapsed module's: it was closed to be read as one.
    if (tier === 'near') {
      const shut = new Set(
        frame.arrangement.boxes.flatMap((box) => (box.kind === 'group' ? [box.id] : [])),
      )
      for (const trunk of frame.arrangement.trunks)
        if (!shut.has(trunk.from) && !shut.has(trunk.to)) ids.add(trunk.id)
    }
    for (const id of lit?.trunks ?? []) ids.add(id)
    for (const id of peek?.trunks ?? []) ids.add(id)
    return ids
  }, [frame, lit, peek, tier])
  const peeked = useMemo(() => new Set(peek?.fans ?? []), [peek])

  // ── ribbons: the links drawn alone, and how each ribbon reads against them ──
  const alone = useMemo(
    () =>
      frame && frame.arrangement.lines === 'ribbons'
        ? drawnAlone(frame, lit, peek?.links ?? NONE)
        : null,
    [frame, lit, peek],
  )
  const peekedLinks = peek?.links ?? NONE
  const ribbonState = useCallback(
    (id: string): Emphasis | 'hidden' => {
      const ribbon = frame?.arrangement.ribbons.find((candidate) => candidate.id === id)
      if (!ribbon || !alone) return 'rest'
      const drawnAlone = (links: ReadonlySet<string>) =>
        ribbon.links.every((link) => links.has(link) && alone.curves.has(link))
      if (lit) return drawnAlone(lit.links) ? 'hidden' : 'dim'
      if (peekedLinks.size > 0) return drawnAlone(peekedLinks) ? 'hidden' : 'dim'
      if (peek && peek.ribbons.size > 0) return peek.ribbons.has(id) ? 'lit' : 'rest'
      return 'rest'
    },
    [alone, frame, lit, peek, peekedLinks],
  )
  const ribbonLayer = useMemo(
    () => (alone ? { emphasis: ribbonState, curves: alone.curves } : undefined),
    [alone, ribbonState],
  )
  // How every line reads and which names are drawn, by one rule (`canvas/emphasis.ts`): the
  // lines a Scene of ribbons draws alone under the pointer read as lit.
  const faint = useMemo(() => (frame ? faintLines(frame.scene, frame.arrangement) : NONE), [frame])
  const lineFocus = useMemo<LineFocus>(
    () => ({ lit, asLit: alone ? peekedLinks : NONE, faint }),
    [alone, faint, lit, peekedLinks],
  )
  const headings = useMemo(
    () => (frame ? bandHeadings(frame.arrangement, frame.placement.boxes) : []),
    [frame],
  )
  const peekedJunctions = useMemo(
    () =>
      new Set(
        (frame?.arrangement.fans ?? [])
          .filter((fan) => peeked.has(fan.id))
          .map((fan) => fan.junction),
      ),
    [frame, peeked],
  )

  // A selection reaching into a shut fold draws its card with that fold open over the map:
  // taller than its place, above what is below it, and nothing else moves.
  const raised = useMemo(() => {
    const cards = new Map<string, { model: BoxModel; rect: Rect }>()
    if (!frame) return cards
    const ids = spotlight?.length ? spotlight : selected ? [selected, ...(lights ?? [])] : []
    for (const [owner, folds] of foldsOpenedBy(frame.scene, ids)) {
      const id = frame.arrangement.boxOf.get(owner)
      const box = frame.arrangement.boxes.find((candidate) => candidate.id === id)
      const rect = id ? frame.placement.boxes.get(id) : undefined
      const shut = id ? frame.placement.models.get(id) : undefined
      if (box?.kind !== 'node' || !rect || !shut) continue
      const node = cardWithFoldsRaised(box.node, folds)
      if (node === box.node) continue
      const model = boxModel({ ...box, node }, frame.placement.detail, measureText, rect.width)
      cards.set(box.id, {
        model,
        rect: { ...rect, height: rect.height + model.height - shut.height },
      })
    }
    return cards
  }, [frame, lights, selected, spotlight])
  // Names and step numbers keep clear of a raised card as of any other: they are placed on
  // the frame as drawn, the raised cards at their full height.
  const labelFrame = useMemo(() => {
    if (!frame || raised.size === 0) return frame
    const boxes = new Map(frame.placement.boxes)
    for (const [id, card] of raised) boxes.set(id, card.rect)
    return { ...frame, placement: { ...frame.placement, boxes } }
  }, [frame, raised])

  const closed = useMemo(
    () =>
      labelFrame
        ? closedLabels(labelFrame.scene, labelFrame.arrangement, labelFrame.placement, measureText)
        : new Map<string, PlacedLabel>(),
    [labelFrame],
  )
  const labels = useMemo(() => {
    if (!labelFrame) return []
    // Far, names are too small to read and none is drawn, but what the reader selected and
    // what a walk steps through: those say their names at every zoom, drawn to read.
    if (tier === 'far') {
      const { scene: drawn, arrangement: arranged, placement } = labelFrame
      const lines = new Map<string, Point[]>()
      for (const id of [...(selected ? [selected] : []), ...(lit?.walk?.ids ?? [])]) {
        if (lines.has(id) || !nameDrawn(id, lineFocus)) continue
        const curve = alone?.curves.get(id)
        const place = arranged.linkPlace.get(id)
        const trunk = place?.trunk
          ? arranged.trunks.find((candidate) => candidate.id === place.trunk)
          : undefined
        const route = trunk ? placement.routes.get(trunk.id) : undefined
        const points =
          curve ??
          (trunk && route
            ? open.has(trunk.id)
              ? memberRoutes(trunk, route).get(id)
              : route
            : undefined)
        if (points) lines.set(id, points)
      }
      return spokenLabels(drawn, arranged, placement, lines, measureText, spoken)
    }
    if (alone) {
      // A line drawn alone is named while lit or under the pointer; at rest, ribbons say it.
      const named = new Map(
        [...alone.curves].filter(
          ([id]) =>
            (lit?.links.has(id) === true || peekedLinks.has(id)) && nameDrawn(id, lineFocus),
        ),
      )
      return curveLabels(
        labelFrame.scene,
        labelFrame.arrangement,
        labelFrame.placement,
        named,
        alone.leavesRow,
        measureText,
        (id) => lit?.links.has(id) === true,
        peekedLinks,
      )
    }
    const result: PlacedLabel[] = []
    // Only the names drawn stand: a dimmed line's takes no room from a lit one's.
    for (const trunk of labelFrame.arrangement.trunks) {
      const label = open.has(trunk.id) ? undefined : closed.get(trunk.id)
      if (label && nameDrawn(trunk.id, lineFocus)) result.push(label)
    }
    // Open trunks place their names around every label already standing, in trunk order.
    for (const trunk of labelFrame.arrangement.trunks) {
      if (!open.has(trunk.id)) continue
      // Counts read near or on focus; constraints only on focus, where they are asked for.
      const focused = lit?.trunks.has(trunk.id) === true
      result.push(
        ...openLabels(
          labelFrame.scene,
          labelFrame.arrangement,
          trunk,
          labelFrame.placement,
          result,
          measureText,
          tier === 'near' || focused,
          focused,
          (id) => nameDrawn(id, lineFocus),
        ),
      )
    }
    return result
  }, [alone, closed, labelFrame, lineFocus, lit, open, peekedLinks, selected, spoken, tier])

  const links = useMemo(
    () => new Map((frame?.scene.links ?? []).map((link) => [link.id, link])),
    [frame],
  )
  const marks = useMemo(
    () => (frame ? ruleMarks(frame.scene, frame.arrangement) : undefined),
    [frame],
  )
  const steps = useMemo(() => {
    const walk = lit?.walk
    if (!labelFrame || !walk) return []
    return walkSteps(labelFrame, labels, walk.steps, tier === 'far' ? spoken : 1)
  }, [labelFrame, labels, lit, spoken, tier])
  const junctionTitles = useMemo(
    () =>
      new Map(
        (frame?.arrangement.boxes ?? []).flatMap((box) =>
          box.kind === 'junction' && frame ? [[box.id, junctionTitle(frame, box)] as const] : [],
        ),
      ),
    [frame],
  )

  // ── reveal ──
  // A reveal asked for before the canvas has measured its pane, or drawn the arrangement it
  // asks of, waits for both: it is honoured once, against the pane as it stands.
  useEffect(() => {
    if (!revealTarget || !frame || frame.arrangement.key !== arrangement.key) return
    if (pane.width === 0 || pane.height === 0) return
    if (!sceneHas(frame.scene, revealTarget) && !rulePlaces(frame.scene).has(revealTarget)) {
      if (isolated) onIsolate(null)
      else onRevealed()
      return
    }
    const box = boxFor(frame, revealTarget)
    const found = box
      ? frame.arrangement.boxes.find((candidate) => candidate.id === box)
      : undefined
    // A collapsed group opens to show its member; a group of rows shows it as a row.
    if (found?.kind === 'group' && found.id !== revealTarget && !found.open) {
      onToggleGroup(found.id)
      return
    }
    const rect = rectOf(frame, revealTarget)
    // The reveal decides the camera: a fit still waiting on the pane would undo it. Measured
    // against where the camera is headed: a target a framing under way brings into view stays
    // where that framing lands it.
    pendingFit.current = false
    if (rect) {
      const view = aim.current ?? viewport.current
      const to = revealRect(view, rect, paneSize.current, insetsRef.current)
      // Brought into view for the selection, it goes back with it; anything else, it stays.
      if (selectedRef.current) follow({ kind: 'reveal', to })
      else if (to !== view) animateTo(to)
    }
    onRevealed()
  }, [
    animateTo,
    arrangement.key,
    frame,
    follow,
    isolated,
    onIsolate,
    onRevealed,
    onToggleGroup,
    pane,
    revealTarget,
  ])

  // ── framing a selection ──
  // A new selection, or a new lens with one, frames its neighbourhood once a frame drawing it
  // for the current arrangement shows; so does the selection the canvas opens with — a thread
  // or a search that opens a level on its target lands as a selection made in place does.
  const framing = useRef<string | null>(selected ? (frameToken ?? null) : null)
  const tokenRef = useRef(frameToken)
  if (tokenRef.current !== frameToken) {
    tokenRef.current = frameToken
    framing.current = selected ? (frameToken ?? null) : null
  }
  useEffect(() => {
    if (!framing.current || !shown || !selected || shown.arrangement.key !== arrangement.key) return
    // Framed for the pane as it now stands — an Inspector opening with the selection has
    // already narrowed it — so the pane's resize after this keeps the frame as it is.
    const bounds = paneRef.current?.getBoundingClientRect()
    if (bounds && bounds.width > 0)
      paneSize.current = { width: bounds.width, height: bounds.height }
    if (paneSize.current.width === 0) return
    framing.current = null
    // A selection the map does not draw is framed from what stands for it.
    const at = rectOf(shown, selected)
      ? selected
      : (lights ?? []).find((id) => rectOf(shown, id) !== undefined)
    if (!at) return
    // The framing decides the camera: a fit still waiting — on the pane, or on the compact
    // cards a first frame asks for — would undo it.
    pendingFit.current = false
    if (intent.current?.kind === 'fit') intent.current = null
    const view = (drawn: Frame) =>
      focusView(
        drawn,
        lit,
        at,
        focusLabels(drawn, lit, measureText),
        paneSize.current,
        insetsRef.current,
      )
    const plain = view(shown)
    // A neighbourhood the pane cannot hold whole, even at the least legible zoom, is drawn in.
    const drawn = plain && !plain.whole && lit ? drawIn(shown, lit, at, measureText) : shown
    const target = drawn === shown ? plain : view(drawn)
    setDrawnFor(drawn === shown ? null : selected)
    // A neighbourhood the camera already shows whole, at the zoom it is framed at, stays where
    // it stands: no card moves (`cameraFor`).
    if (target) follow({ kind: 'frame', target, drawnIn: drawn !== shown })
    framedFor.current = tokenRef.current ?? null
    // `pane`: a selection made before the pane is measured is framed once it is; `reframe`: the
    // stage changed the room it is framed in.
  }, [arrangement.key, follow, lights, lit, pane, reframe, selected, shown])

  // A selection ended: the camera goes back to where it stood before the Studio framed it, a
  // frame later — the panel the selection opened closes with it, and gives back its room.
  const heldSelection = useRef(selected)
  useLayoutEffect(() => {
    const was = heldSelection.current
    heldSelection.current = selected
    if (was === selected) return
    if (releasing.current !== null) cancelAnimationFrame(releasing.current)
    releasing.current = null
    if (was === undefined || selected !== undefined) return
    releasing.current = requestAnimationFrame(() => {
      releasing.current = null
      const bounds = paneRef.current?.getBoundingClientRect()
      if (bounds && bounds.width > 0)
        paneSize.current = { width: bounds.width, height: bounds.height }
      follow({ kind: 'release' })
    })
  }, [follow, selected])

  // ── input ──
  const drag = useRef<{
    x: number
    y: number
    from: Viewport
    moved: boolean
    pointerId: number
    /** the boxes this press moves; none pans */
    grip?: string[]
  } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    const element = paneRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      stopAnimation()
      byHand()
      setJunctionMenu(null)
      const bounds = element.getBoundingClientRect()
      const at = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      apply(zoomAbout(viewport.current, at, Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002))))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [apply, byHand, stopAnimation])

  /** Shows the dragged boxes moved by `by`, every line and label following. */
  const showPlacing = (state: Placing, by: Point) => {
    const frame = { ...state.origin, placement: placingPlacement(state, by) }
    shownRef.current = frame
    setShown(frame)
  }
  const startPlacing = (ids: string[], element: HTMLElement) => {
    const origin = shownRef.current
    if (!origin) return
    // The reader places boxes where the layout put them, not where a focus drew them in.
    setDrawnFor(null)
    placing.current = {
      ids,
      origin,
      corners: new Map(
        [...origin.placement.boxes].map(([id, rect]) => [id, { x: rect.x, y: rect.y }]),
      ),
      by: { x: 0, y: 0 },
      frame: null,
    }
    element.setAttribute('data-placing', '')
    setDragging(true)
  }
  const movePlacing = (by: Point) => {
    const state = placing.current
    if (!state) return
    state.by = by
    // One layout per painted frame, however fast the pointer reports.
    state.frame ??= requestAnimationFrame(() => {
      state.frame = null
      if (placing.current === state) showPlacing(state, state.by)
    })
  }
  const endPlacing = (element: HTMLElement) => {
    const state = placing.current
    placing.current = null
    element.removeAttribute('data-placing')
    setDragging(false)
    if (!state) return
    if (state.frame !== null) cancelAnimationFrame(state.frame)
    // The dragged boxes rest exactly where they were let go; what they land on makes room.
    const dropped = new Map(state.origin.pins)
    for (const id of state.ids) {
      const corner = state.corners.get(id)!
      dropped.set(id, { x: corner.x + state.by.x, y: corner.y + state.by.y })
    }
    // A module holding a moved box is recorded by its members' corner as they now stand.
    const moving = new Set(state.ids)
    for (const region of state.origin.arrangement.regions) {
      if (!region.members.some((id) => moving.has(id))) continue
      const corners = region.members.flatMap((id) => dropped.get(id) ?? [])
      dropped.set(region.id, {
        x: Math.min(...corners.map((corner) => corner.x)),
        y: Math.min(...corners.map((corner) => corner.y)),
      })
    }
    const pinned = settleDrop(state.origin.placement, state.origin.arrangement, dropped, state.ids)
    const placement = pinPlacement(state.origin.placement, state.origin.arrangement, pinned, {
      stack: false,
    }).placement
    const frame = { ...state.origin, placement, pins: pinned }
    shownRef.current = frame
    setShown(frame)
    onPlace(pinned)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !ownTarget(event)) return
    if ((event.target as Element).closest('[data-canvas-chrome]')) return
    stopAnimation()
    const frame = shownRef.current
    // Choosing a comment's target clicks the canvas's parts; nothing moves meanwhile.
    const grip =
      frame && !document.body.hasAttribute('data-target-mode')
        ? gripOf(frame, event.target as Element)
        : undefined
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      from: viewport.current,
      moved: false,
      pointerId: event.pointerId,
      ...(grip ? { grip } : {}),
    }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    pointer.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    const current = drag.current
    if (!current) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (!current.moved && Math.hypot(dx, dy) < 4) return
    if (!current.moved) {
      current.moved = true
      event.currentTarget.setPointerCapture(current.pointerId)
      if (current.grip) startPlacing(current.grip, event.currentTarget)
      else {
        event.currentTarget.setAttribute('data-panning', '')
        byHand()
      }
      setJunctionMenu(null)
    }
    if (current.grip) {
      const zoom = viewport.current.zoom
      movePlacing({ x: dx / zoom, y: dy / zoom })
      return
    }
    apply({ ...current.from, x: current.from.x + dx, y: current.from.y + dy })
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current
    drag.current = null
    if (!current?.moved) return
    suppressClick.current = true
    if (current.grip) endPlacing(event.currentTarget)
    event.currentTarget.removeAttribute('data-panning')
    if (event.currentTarget.hasPointerCapture(current.pointerId)) {
      event.currentTarget.releasePointerCapture(current.pointerId)
    }
  }
  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (!frame || !ownTarget(event)) return
    const target = event.target as Element
    if (target.closest('[data-canvas-chrome]')) return
    // A ribbon of one link is that link; a ribbon of several is read, not chosen.
    const ribbon = target.closest('[data-ribbon-id]')
    if (ribbon && !ribbon.hasAttribute('data-select-id')) return
    const junctionElement = target.closest('[data-junction-id]')
    const junctionId = junctionElement?.getAttribute('data-junction-id')
    const junction = frame.arrangement.boxes.find((box) => box.id === junctionId)
    if (junctionElement && junction?.kind === 'junction') {
      // A junction of one link is that link; of several, a menu of them and its set.
      if (junction.links.length === 1) return onSelect(junction.links[0])
      return setJunctionMenu({ junction, element: junctionElement })
    }
    const link = target.closest<HTMLElement | SVGElement>('[data-select-id]')
    const linkId = link?.getAttribute('data-select-id')
    if (linkId) return onSelect(linkId)
    const box = target.closest<HTMLElement>('[data-box-id]')?.dataset.boxId
    if (box) return onSelect(selectionOf(frame.arrangement, box))
    const region = target.closest<HTMLElement>('[data-region-header]')?.dataset.regionHeader
    if (region) return onSelect(region)
    onSelect(undefined)
  }
  const onPointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.moved || !ownTarget(event)) return
    // What the camera's glide brings under a still pointer is not hovered.
    if (!pointing.pointed(event.clientX, event.clientY)) return
    const element = (event.target as Element).closest('[data-hover-id]')
    setHovered(element?.getAttribute('data-hover-id') ?? null)
  }

  // Keys reach the canvas wherever focus is, unless something else is typing or handling them:
  // a dialog, the Index, the Inspector or the stage keep their own.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const ui = useUI.getState()
      if (ui.paletteOpen || ui.commentMode || ui.askMode || ui.settingsOpen) return
      if (
        (event.target as Element | null)?.closest?.(
          '[role="dialog"], [data-index-rail], [data-inspector], [data-stage]',
        )
      )
        return
      const current = shownRef.current
      if (!current) return
      if (event.key === 'Escape') {
        if (junctionMenu) return
        if (isolated) {
          event.preventDefault()
          onIsolate(null)
        }
        return
      }
      if (event.key === 'f' || event.key === 'F') {
        const target = selected && sceneHas(current.scene, selected) ? selected : isolated
        if (!target) return
        event.preventDefault()
        intent.current = { kind: 'fit' }
        onIsolate(isolated === target ? null : target)
        return
      }
      if (event.key === '.') {
        event.preventDefault()
        byHand()
        fit(true)
        return
      }
      const direction = ARROWS[event.key]
      if (!direction) return
      event.preventDefault()
      const { placement, arrangement: arranged } = current
      // A walk stops on what can be selected: cards and groups, never a junction.
      const stops = new Map([...placement.boxes].filter(([id]) => !isJunction(id)))
      const from = selected ? arranged.boxOf.get(selected) : undefined
      const fromRect = from ? stops.get(from) : undefined
      if (!fromRect) {
        const centre = toWorld(viewport.current, {
          x: paneSize.current.width / 2,
          y: paneSize.current.height / 2,
        })
        const start = nearestBox(placement, centre, (id) => !isJunction(id))
        if (start) onSelect(selectionOf(arranged, start))
        return
      }
      const focus = selected ? neighbourhood(current.scene, arranged, selected) : null
      const candidates =
        focus && focus.boxes.size > 1
          ? new Map([...stops].filter(([id]) => focus.boxes.has(id)))
          : stops
      const next =
        walk(fromRect, candidates, direction, from) ?? walk(fromRect, stops, direction, from)
      if (!next) return
      onSelect(selectionOf(arranged, next))
      const rect = placement.boxes.get(next)
      const view = aim.current ?? viewport.current
      if (rect)
        follow({
          kind: 'reveal',
          to: revealRect(view, rect, paneSize.current, insetsRef.current),
        })
    }
    // Capture: `Esc` leaves an isolated neighbourhood before anything clears the selection.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [byHand, fit, follow, isolated, junctionMenu, onIsolate, onSelect, selected])

  // Entering or leaving an isolated neighbourhood lays the scene out afresh and frames it whole.
  const isolatedRef = useRef(isolated)
  if (isolatedRef.current !== isolated) {
    isolatedRef.current = isolated
    intent.current = { kind: 'fit' }
  }

  const emphasisOf = (box: string): Emphasis =>
    lit ? (lit.boxes.has(box) ? 'lit' : 'dim') : 'rest'
  const regionEmphasis = (region: string, members: readonly string[]): Emphasis =>
    lit
      ? lit.regions.has(region) || members.some((member) => lit.boxes.has(member))
        ? 'rest'
        : 'dim'
      : 'rest'
  const leavingBoxes = leaving
    ? leaving.arrangement.boxes.filter((box) => !frame?.placement.boxes.has(box.id))
    : []
  const isolatedLabel = isolated
    ? (scene.nodes.find((node) => node.id === isolated)?.label ??
      scene.links.filter((link) => link.id === isolated).map(linkName)[0] ??
      scene.groups.find((group) => group.id === isolated)?.label ??
      isolated)
    : undefined

  return (
    <div
      ref={paneRef}
      data-testid="scene-canvas"
      data-domain-id={domainId}
      {...targetSurface('canvas')}
      data-tier={tier}
      data-moving={moving || undefined}
      // The frame drawn is an earlier arrangement's while the current one is laid out.
      data-laying-out={shown && shown.arrangement.key !== arrangement.key ? '' : undefined}
      data-focused={lit ? '' : undefined}
      data-lines={frame?.scene.lineWeight === 'thin' ? 'thin' : undefined}
      className="scene-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerOver={onPointerOver}
      onPointerLeave={() => {
        pointer.current = null
        setHovered(null)
      }}
      onClick={onClick}
    >
      <div ref={worldRef} className="scene-world">
        {frame && (
          <>
            {frame.arrangement.regions.map((region) => {
              const rect = frame.placement.regions.get(region.id)
              if (!rect) return null
              return (
                <RegionView
                  key={region.id}
                  group={region.group}
                  rect={rect}
                  members={region.members.length}
                  tier={tier}
                  emphasis={regionEmphasis(region.id, region.members)}
                  selected={selected === region.id}
                  domainId={domainId}
                  onToggleGroup={onToggleGroup}
                />
              )
            })}
            {headings.map((heading) => (
              <BandHeading key={heading.column} label={heading.label} rect={heading.rect} />
            ))}
            <LinksLayer
              frame={frame}
              open={open}
              focus={lineFocus}
              peeked={peeked}
              selected={selected}
              ribbons={ribbonLayer}
            />
            {frame.arrangement.boxes.map((box) => {
              const rect = frame.placement.boxes.get(box.id)
              const model = frame.placement.models.get(box.id)
              if (!rect || !model) return null
              if (box.kind === 'junction')
                return (
                  <JunctionView
                    key={box.id}
                    junction={box}
                    rect={rect}
                    title={junctionTitles.get(box.id) ?? 'One of'}
                    emphasis={emphasisOf(box.id)}
                    hovered={hovered === box.id || peekedJunctions.has(box.id)}
                  />
                )
              const hue =
                box.kind === 'group'
                  ? box.group.hue
                  : box.group
                    ? frame.scene.groups.find((group) => group.id === box.group)?.hue
                    : undefined
              const lifted = raised.get(box.id)
              return (
                <BoxView
                  key={box.id}
                  box={box}
                  model={lifted?.model ?? model}
                  rect={lifted?.rect ?? rect}
                  raised={lifted !== undefined}
                  hue={hue}
                  tier={tier}
                  emphasis={emphasisOf(box.id)}
                  selected={
                    selected !== undefined && selectionOf(frame.arrangement, box.id) === selected
                  }
                  hovered={
                    hovered === box.id ||
                    (hovered !== null && selectionOf(frame.arrangement, box.id) === hovered)
                  }
                  domainId={domainId}
                  onToggleGroup={onToggleGroup}
                  onToggleFold={onToggleFold}
                  {...(box.kind === 'group' && box.open
                    ? { selectedId: selected, hoveredId: hovered, litNodes: lit?.nodes ?? null }
                    : model.rules.length > 0
                      ? {
                          selectedId: selected,
                          hoveredId: hovered,
                          litRules: lit?.rules ?? null,
                          litNames: lit?.named ?? null,
                        }
                      : {})}
                />
              )
            })}
            {leaving &&
              leavingBoxes.map((box) => {
                const rect = leaving.placement.boxes.get(box.id)
                const model = leaving.placement.models.get(box.id)
                if (!rect || !model) return null
                if (box.kind === 'junction')
                  return (
                    <JunctionView
                      key={`leaving:${box.id}`}
                      junction={box}
                      rect={rect}
                      title=""
                      emphasis="rest"
                      leaving
                    />
                  )
                return (
                  <BoxView
                    key={`leaving:${box.id}`}
                    box={box}
                    model={model}
                    rect={rect}
                    tier={tier}
                    emphasis="rest"
                    selected={false}
                    hovered={false}
                    domainId={domainId}
                    leaving
                    onToggleGroup={onToggleGroup}
                  />
                )
              })}
            <div
              className="scene-labels"
              data-step-pointing={
                pointedStep !== null && steps.some((step) => step.number === pointedStep)
                  ? ''
                  : undefined
              }
            >
              <LabelsLayer
                labels={labels}
                focus={lineFocus}
                selected={selected}
                links={links}
                ruleMarks={marks}
              />
              {steps.map((step) => (
                <span
                  key={`${step.id}:${step.number}`}
                  className="scene-step"
                  data-step={step.id}
                  data-step-number={step.number}
                  data-pointed={pointedStep === step.number ? '' : undefined}
                  data-rule-tone={lit?.walk?.tone}
                  style={
                    {
                      transform: `translate(${step.at.x}px, ${step.at.y}px)${step.scale === 1 ? '' : ` scale(${step.scale})`}`,
                      transformOrigin: '0 0',
                      ...(lit?.walk ? { '--step-tone': TONE_COLOR[lit.walk.tone] } : {}),
                    } as CSSProperties
                  }
                >
                  {step.number}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* A lens that draws nothing says what it found none of, instead of a blank pane. */}
      {frame && frame.arrangement.boxes.length === 0 && (
        <div role="status" data-testid="scene-empty" className="scene-empty">
          {frame.scene.empty ?? 'This lens draws nothing here.'}
        </div>
      )}

      {/* ── what the selection has past the edges ── */}
      <OffFramePointers
        frame={labelFrame}
        rules={selectedRules}
        lit={lit?.boxes ?? null}
        camera={cameraNow}
        subscribe={onRest}
        onGo={goTo}
      />

      {/* ── chrome ── */}
      <div
        data-canvas-chrome
        className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-2"
      >
        {/* The folds read beside the toolbar, in the band the canvas keeps clear for it. */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          {options.length > 0 && (
            <CanvasToolbar>
              {options.map((option) => (
                <CanvasIconToggle
                  key={option.id}
                  icon={option.icon}
                  label={option.label}
                  hint={option.description}
                  pressed={option.value}
                  onClick={() => {
                    // An option changes what is drawn, so the new scene is framed whole.
                    intent.current = { kind: 'fit' }
                    onOption?.(option.id, !option.value)
                  }}
                />
              ))}
            </CanvasToolbar>
          )}
          {(frame?.arrangement.folded ?? []).map((fold) => {
            const content = (
              <>
                {fold.label} <span className="tabular-nums">{fold.count}</span>
                <span className="text-muted-foreground/80"> · {fold.reason}</span>
              </>
            )
            // A fold another lens draws is a way there.
            return fold.lens && onLens ? (
              <button
                key={fold.label}
                type="button"
                data-testid="scene-folded"
                data-lens={fold.lens}
                className="scene-folded"
                title={fold.reason}
                onClick={() => onLens(fold.lens!)}
              >
                {content}
              </button>
            ) : (
              <span
                key={fold.label}
                data-testid="scene-folded"
                className="scene-folded"
                title={fold.reason}
              >
                {content}
              </span>
            )
          })}
        </div>
        <div className="flex flex-1 justify-center">
          {isolated && (
            <div data-testid="scene-isolated" className="scene-isolated pointer-events-auto">
              <Focus className="h-3.5 w-3.5 text-primary" />
              <span>
                <span className="font-medium text-foreground">{isolatedLabel}</span> and its
                neighbourhood
              </span>
              <button
                type="button"
                className="scene-isolated-exit"
                onClick={() => onIsolate(null)}
                title="Show everything (Esc)"
                aria-label="Show everything"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        <div className="pointer-events-auto">
          <CanvasToolbar>
            <ZoomButton
              label="Zoom out"
              onClick={() => {
                byHand()
                animateTo(zoomAbout(viewport.current, centreOf(pane), 1 / ZOOM_STEP))
              }}
            >
              <Minus />
            </ZoomButton>
            <span
              ref={zoomLabelRef}
              className="w-10 text-center text-[11px] tabular-nums text-muted-foreground"
            >
              100%
            </span>
            <ZoomButton
              label="Zoom in"
              onClick={() => {
                byHand()
                animateTo(zoomAbout(viewport.current, centreOf(pane), ZOOM_STEP))
              }}
            >
              <Plus />
            </ZoomButton>
            <ZoomButton
              label="Fit"
              shortcut="."
              onClick={() => {
                byHand()
                fit(true)
              }}
            >
              <Maximize />
            </ZoomButton>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
            <ZoomButton
              label="Auto-arrange"
              hint={
                onAutoArrange
                  ? 'Auto-arrange — forget where boxes were placed in this lens'
                  : 'Auto-arrange — nothing is placed in this lens'
              }
              disabled={!onAutoArrange}
              onClick={() => {
                intent.current = { kind: 'fit' }
                onAutoArrange?.()
              }}
            >
              <LayoutGrid />
            </ZoomButton>
          </CanvasToolbar>
        </div>
      </div>

      {junctionMenu && frame && (
        <JunctionMenu
          junction={junctionMenu.junction}
          element={junctionMenu.element}
          frame={frame}
          onSelect={(id) => {
            setJunctionMenu(null)
            onSelect(id)
          }}
          onClose={() => setJunctionMenu(null)}
        />
      )}
    </div>
  )
}

/**
 * Whether an event happened on the canvas itself. Popovers opened from the canvas (a junction's
 * links, a comment thread) are portalled elsewhere in the page but still bubble through it.
 */
const ownTarget = (event: SyntheticEvent<HTMLElement>) =>
  event.currentTarget.contains(event.target as Node)

const centreOf = (pane: { width: number; height: number }) => ({
  x: pane.width / 2,
  y: pane.height / 2,
})

function ZoomButton({
  label,
  shortcut,
  hint,
  disabled,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  /** the title, when it says more than the label */
  hint?: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={hint ?? (shortcut ? `${label} (${shortcut})` : label)}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-3.5 [&_svg]:w-3.5"
    >
      {children}
    </button>
  )
}

/** The links that meet a junction, and the set it stands for — each one a way in. */
function JunctionMenu({
  junction,
  element,
  frame,
  onSelect,
  onClose,
}: {
  junction: JunctionBox
  element: Element
  frame: Frame
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const anchor = useRef(element)
  anchor.current = element
  const links = junction.links
    .map((id) => frame.scene.links.find((link) => link.id === id))
    .filter((link) => link !== undefined)
  const boxes = new Map(frame.arrangement.boxes.map((box) => [box.id, box]))
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent side="bottom" align="center" className="w-72 p-1.5" data-canvas-chrome>
        <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          One of · {junction.accepts.length}
        </div>
        <div className="flex flex-wrap gap-1 px-2 pb-1.5">
          {junction.accepts.map((id) => {
            const box = boxes.get(id)
            const target = box ? selectionOf(frame.arrangement, id) : id
            const label =
              box?.kind === 'node' ? box.node.label : box?.kind === 'group' ? box.group.label : id
            const origin = box?.kind === 'node' ? box.node.sublabel : undefined
            return (
              <button
                key={id}
                type="button"
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  origin
                    ? 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                    : 'bg-schema-node/10 text-schema-node hover:bg-schema-node/20',
                )}
                onClick={() => onSelect(target)}
              >
                {label}
                {origin && <span className="ml-1 font-normal opacity-75">{origin}</span>}
              </button>
            )
          })}
        </div>
        <div className="mt-1 border-t px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {links.length} {links.length === 1 ? 'link' : 'links'} through it
        </div>
        {links.map((link) => {
          const place = frame.arrangement.linkPlace.get(link.id)
          const end = place?.to === junction.id ? link.to : link.from
          return (
            <button
              key={link.id}
              type="button"
              className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
              {...(link.anchor ? anchorData(link.anchor, linkName(link)) : {})}
              onClick={() => onSelect(link.opens ?? link.id)}
            >
              <span className="font-mono text-[12px]">{linkName(link)}</span>
              {end.role && (
                <span className="ml-auto text-[11px] text-muted-foreground">{end.role}</span>
              )}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
