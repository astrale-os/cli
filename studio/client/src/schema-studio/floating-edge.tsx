import { SmartEdge } from '@tisoap/react-flow-smart-edge'
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type InternalNode,
  type Node,
  Position,
  getSmoothStepPath,
  useInternalNode,
} from '@xyflow/react'
import { type RefObject, useLayoutEffect, useRef } from 'react'

import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import {
  edgeLabelRect,
  placeEdgeLabel,
  type EdgeLabelObstacle,
  type EdgeLabelObstacleIndex,
  type EdgeLabelObstacleSource,
  type EdgePathSample,
} from './edge-label-layout'
import { type FloatingEdgePort, SMART_EDGE_RENDER_OPTIONS } from './edge-routing'

/** One end of a relationship as the schema declares it. */
export interface FloatingEdgeEnd {
  role?: string
  cardinality: string
}

/** Where this edge sits relative to the focused node: wired to it, or context behind it. */
export type EdgeFocus = 'on' | 'dim'

interface FloatingEdgeData extends Record<string, unknown> {
  label?: string
  kind?: string
  selected?: boolean
  focus?: EdgeFocus
  sourcePort?: FloatingEdgePort
  targetPort?: FloatingEdgePort
  sourceEnd?: FloatingEdgeEnd
  targetEnd?: FloatingEdgeEnd
  labelObstacleIndex?: EdgeLabelObstacleIndex
}

interface FloatingEdgeGeometry {
  sx: number
  sy: number
  tx: number
  ty: number
  sourcePosition: Position
  targetPosition: Position
}

interface EdgeLabelElements {
  path: RefObject<SVGGElement | null>
  main: RefObject<HTMLDivElement | null>
  source: RefObject<HTMLDivElement | null>
  target: RefObject<HTMLDivElement | null>
}

const EMPTY_LABEL_OBSTACLES: EdgeLabelObstacle[] = []
const PATH_SAMPLE_GAP = 8
const MAX_PATH_SAMPLES = 256
const ENDPOINT_CHIP_DISTANCE = 25
const MIN_CHIP_PATH_LENGTH = 110
const PATH_SAMPLE_CACHE = new WeakMap<
  SVGPathElement,
  { pathData: string | null; samples: EdgePathSample[] }
>()

// Standard react-flow "floating edge" geometry: connect at the node border on
// the side facing the other node, so edges take a sane path regardless of where
// the two nodes sit (no more everything-exits-the-bottom).

function getNodeIntersection(intersectionNode: InternalNode<Node>, targetNode: InternalNode<Node>) {
  const w = (intersectionNode.measured.width ?? 0) / 2
  const h = (intersectionNode.measured.height ?? 0) / 2
  const ip = intersectionNode.internals.positionAbsolute
  const tp = targetNode.internals.positionAbsolute
  const x2 = ip.x + w
  const y2 = ip.y + h
  const x1 = tp.x + (targetNode.measured.width ?? 0) / 2
  const y1 = tp.y + (targetNode.measured.height ?? 0) / 2
  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h)
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h)
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1)
  const xx3 = a * xx1
  const yy3 = a * yy1
  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 }
}

function getEdgePosition(node: InternalNode<Node>, point: { x: number; y: number }): Position {
  const n = node.internals.positionAbsolute
  const nx = Math.round(n.x)
  const ny = Math.round(n.y)
  const px = Math.round(point.x)
  const py = Math.round(point.y)
  if (px <= nx + 1) return Position.Left
  if (px >= nx + (node.measured.width ?? 0) - 1) return Position.Right
  if (py <= ny + 1) return Position.Top
  return Position.Bottom
}

function getEdgeParams(source: InternalNode<Node>, target: InternalNode<Node>) {
  const sp = getNodeIntersection(source, target)
  const tp = getNodeIntersection(target, source)
  return {
    sx: sp.x,
    sy: sp.y,
    tx: tp.x,
    ty: tp.y,
    sourcePos: getEdgePosition(source, sp),
    targetPos: getEdgePosition(target, tp),
  }
}

function pointAtPort(
  node: InternalNode<Node>,
  port: FloatingEdgePort | undefined,
): { x: number; y: number; position: Position } | null {
  if (!port) return null
  const origin = node.internals.positionAbsolute
  const width = node.measured.width ?? 0
  const height = node.measured.height ?? 0
  if (width <= 0 || height <= 0) return null
  const offset = Math.min(1, Math.max(0, port.offset))

  switch (port.position) {
    case Position.Left:
      return { x: origin.x, y: origin.y + height * offset, position: port.position }
    case Position.Right:
      return { x: origin.x + width, y: origin.y + height * offset, position: port.position }
    case Position.Top:
      return { x: origin.x + width * offset, y: origin.y, position: port.position }
    case Position.Bottom:
      return { x: origin.x + width * offset, y: origin.y + height, position: port.position }
  }
}

function fallbackPathSamples(geometry: FloatingEdgeGeometry | null): EdgePathSample[] {
  if (!geometry) return []
  const middle = { x: (geometry.sx + geometry.tx) / 2, y: (geometry.sy + geometry.ty) / 2 }
  const firstLength = Math.hypot(middle.x - geometry.sx, middle.y - geometry.sy)
  return [
    { x: geometry.sx, y: geometry.sy, distance: 0 },
    { ...middle, distance: firstLength },
    {
      x: geometry.tx,
      y: geometry.ty,
      distance: firstLength + Math.hypot(geometry.tx - middle.x, geometry.ty - middle.y),
    },
  ]
}

function renderedPathSamples(
  path: SVGPathElement | null,
  geometry: FloatingEdgeGeometry | null,
): EdgePathSample[] {
  if (!path || typeof path.getTotalLength !== 'function') return fallbackPathSamples(geometry)
  try {
    const pathData = path.getAttribute('d')
    const cached = PATH_SAMPLE_CACHE.get(path)
    if (cached?.pathData === pathData) return cached.samples
    const length = path.getTotalLength()
    if (!Number.isFinite(length) || length <= 0) return fallbackPathSamples(geometry)
    const segments = Math.max(2, Math.min(MAX_PATH_SAMPLES, Math.ceil(length / PATH_SAMPLE_GAP)))
    const samples = Array.from({ length: segments + 1 }, (_, index) => {
      const distance = (length * index) / segments
      const point = path.getPointAtLength(distance)
      return { x: point.x, y: point.y, distance }
    })
    PATH_SAMPLE_CACHE.set(path, { pathData, samples })
    return samples
  } catch {
    return fallbackPathSamples(geometry)
  }
}

function hideLabel(element: HTMLDivElement | null) {
  if (element) element.style.visibility = 'hidden'
}

function placeLabelElement(
  id: string,
  element: HTMLDivElement | null,
  samples: EdgePathSample[],
  obstacles: EdgeLabelObstacleSource,
  additionalObstacles: EdgeLabelObstacle[],
  preferredDistance: number,
  maxPathDistance?: number,
): EdgeLabelObstacle | null {
  if (!element) return null
  const size = {
    width: Math.max(element.offsetWidth, 16),
    height: Math.max(element.offsetHeight, 12),
  }
  const point = placeEdgeLabel(samples, size, obstacles, {
    preferredDistance,
    maxPathDistance,
    additionalObstacles,
  })
  if (!point) {
    hideLabel(element)
    return null
  }

  element.style.transform = `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`
  element.style.visibility = 'visible'
  return { id, ...edgeLabelRect(point, size) }
}

function useEdgeLabelLayout({
  id,
  elements,
  geometry,
  obstacles,
  hasMainLabel,
  sourceChip,
  targetChip,
  selected,
}: {
  id: string
  elements: EdgeLabelElements
  geometry: FloatingEdgeGeometry | null
  obstacles: EdgeLabelObstacleSource
  hasMainLabel: boolean
  sourceChip?: FloatingEdgeEnd
  targetChip?: FloatingEdgeEnd
  selected: boolean
}) {
  useLayoutEffect(() => {
    const update = () => {
      const path = elements.path.current?.querySelector<SVGPathElement>(
        'path.react-flow__edge-path',
      )
      const samples = renderedPathSamples(path ?? null, geometry)
      const pathLength = samples.at(-1)?.distance ?? 0
      const occupied: EdgeLabelObstacle[] = []

      if (hasMainLabel) {
        const placed = placeLabelElement(
          `${id}:label`,
          elements.main.current,
          samples,
          obstacles,
          occupied,
          pathLength / 2,
        )
        if (placed) occupied.push(placed)
      } else hideLabel(elements.main.current)

      if (sourceChip && pathLength >= MIN_CHIP_PATH_LENGTH) {
        const placed = placeLabelElement(
          `${id}:source`,
          elements.source.current,
          samples,
          obstacles,
          occupied,
          ENDPOINT_CHIP_DISTANCE,
          40,
        )
        if (placed) occupied.push(placed)
      } else hideLabel(elements.source.current)

      if (targetChip && pathLength >= MIN_CHIP_PATH_LENGTH) {
        placeLabelElement(
          `${id}:target`,
          elements.target.current,
          samples,
          obstacles,
          occupied,
          Math.max(0, pathLength - ENDPOINT_CHIP_DISTANCE),
          40,
        )
      } else hideLabel(elements.target.current)
    }

    update()
    const group = elements.path.current
    let mutationObserver: MutationObserver | null = null
    if (group && typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(update)
      mutationObserver.observe(group, {
        attributes: true,
        attributeFilter: ['d'],
        childList: true,
        subtree: true,
      })
    }

    return () => {
      mutationObserver?.disconnect()
    }
  }, [elements, geometry, hasMainLabel, id, obstacles, selected, sourceChip, targetChip])
}

export function FloatingEdge(props: EdgeProps) {
  const { id, source, target, style, data } = props
  const showCardinality = useUI((state) => state.showCardinality)
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const d = data as FloatingEdgeData | undefined
  // A dashed inheritance trace already says "extends". Repeating that word on every long
  // connector adds noise without information, so relationship labels keep the visual priority.
  const label = d?.kind === 'extends' ? undefined : d?.label
  const selected = d?.selected === true
  // The <g> that carries the edge's focus class is not this label's ancestor — React Flow
  // portals labels into its own layer — so the class has to be repeated here by hand.
  const focusCls = d?.focus === 'on' ? 'is-on' : d?.focus === 'dim' ? 'is-dimmed' : undefined
  const sourceChip = showCardinality ? d?.sourceEnd : undefined
  const targetChip = showCardinality ? d?.targetEnd : undefined
  const pathRef = useRef<SVGGElement>(null)
  const mainLabelRef = useRef<HTMLDivElement>(null)
  const sourceLabelRef = useRef<HTMLDivElement>(null)
  const targetLabelRef = useRef<HTMLDivElement>(null)
  const elements = useRef<EdgeLabelElements>({
    path: pathRef,
    main: mainLabelRef,
    source: sourceLabelRef,
    target: targetLabelRef,
  }).current

  let geometry: FloatingEdgeGeometry | null = null
  if (sourceNode && targetNode) {
    const sourcePort = pointAtPort(sourceNode, d?.sourcePort)
    const targetPort = pointAtPort(targetNode, d?.targetPort)
    const fallback = getEdgeParams(sourceNode, targetNode)
    geometry = {
      sx: sourcePort?.x ?? fallback.sx,
      sy: sourcePort?.y ?? fallback.sy,
      tx: targetPort?.x ?? fallback.tx,
      ty: targetPort?.y ?? fallback.ty,
      sourcePosition: sourcePort?.position ?? fallback.sourcePos,
      targetPosition: targetPort?.position ?? fallback.targetPos,
    }
  }

  useEdgeLabelLayout({
    id,
    elements,
    geometry,
    obstacles: d?.labelObstacleIndex ?? EMPTY_LABEL_OBSTACLES,
    hasMainLabel: Boolean(label),
    sourceChip,
    targetChip,
    selected,
  })

  if (!geometry) return null

  const { sx, sy, tx, ty, sourcePosition, targetPosition } = geometry
  const strokeColor = selected
    ? 'var(--color-primary)'
    : ((style?.stroke as string) ?? 'var(--color-muted-foreground)')
  const edgeStyle = selected ? { ...style, stroke: strokeColor, strokeWidth: 3 } : style
  return (
    <>
      <g ref={pathRef}>
        <SmartEdge
          {...props}
          sourceX={sx}
          sourceY={sy}
          targetX={tx}
          targetY={ty}
          sourcePosition={sourcePosition}
          targetPosition={targetPosition}
          preset="smoothstep"
          options={SMART_EDGE_RENDER_OPTIONS}
          style={edgeStyle}
          label={undefined}
          interactionWidth={18}
        />
      </g>
      <EdgeLabelRenderer>
        {label ? (
          <div
            ref={mainLabelRef}
            data-edge-id={id}
            className={cn('schema-edge-label', focusCls)}
            style={selected ? { color: strokeColor, fontWeight: 600 } : undefined}
          >
            {label}
          </div>
        ) : null}
        {sourceChip ? (
          <div
            ref={sourceLabelRef}
            data-edge-id={id}
            title={endpointTitle(sourceChip, d?.label)}
            className={cn('schema-edge-label schema-edge-cardinality', focusCls)}
          >
            {sourceChip.cardinality}
          </div>
        ) : null}
        {targetChip ? (
          <div
            ref={targetLabelRef}
            data-edge-id={id}
            title={endpointTitle(targetChip, d?.label)}
            className={cn('schema-edge-label schema-edge-cardinality', focusCls)}
          >
            {targetChip.cardinality}
          </div>
        ) : null}
      </EdgeLabelRenderer>
    </>
  )
}

/** The chip shows the multiplicity alone; the role rides in the native tooltip. */
function endpointTitle(end: FloatingEdgeEnd, edge?: string): string {
  const subject = end.role ?? edge ?? 'this end'
  return `${subject}: ${end.cardinality}`
}

// Orthogonal "elbow" edge for the structural parent→child tree. The core canvas
// lays out strictly left→right, so we route from the parent's right edge into the
// child's left edge (flipping sides if a drag puts the child on the left) — a clean
// org-chart skeleton that reads apart from the bezier "wiring" of the typed edges.
export function TreeEdge({ id, source, target, style }: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const sp = sourceNode.internals.positionAbsolute
  const tp = targetNode.internals.positionAbsolute
  const sw = sourceNode.measured.width ?? 0
  const sh = sourceNode.measured.height ?? 0
  const tw = targetNode.measured.width ?? 0
  const th = targetNode.measured.height ?? 0
  const childRight = tp.x >= sp.x
  const [path] = getSmoothStepPath({
    sourceX: childRight ? sp.x + sw : sp.x,
    sourceY: sp.y + sh / 2,
    sourcePosition: childRight ? Position.Right : Position.Left,
    targetX: childRight ? tp.x : tp.x + tw,
    targetY: tp.y + th / 2,
    targetPosition: childRight ? Position.Left : Position.Right,
    borderRadius: 16,
  })
  return <BaseEdge id={id} path={path} style={style} interactionWidth={18} />
}

export const edgeTypes = { floating: FloatingEdge, tree: TreeEdge }
