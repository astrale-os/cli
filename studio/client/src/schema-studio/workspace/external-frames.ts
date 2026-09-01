import type { DomainCatalogEntry } from '@shared/types'
import type { Node } from '@xyflow/react'

import {
  WORKSPACE_DOMAIN_GAP,
  type WorkspaceDomainFrame,
  type WorkspacePoint,
  type WorkspaceSize,
} from './geometry'

export interface WorkspaceExternalReference {
  origin: string
  name: string
  definition: 'class'
}

export interface WorkspaceExternalCluster {
  origin: string
  members: WorkspaceExternalReference[]
  ownerDomainIds: string[]
}

export interface WorkspaceExternalProjection {
  nodes: Node[]
  positions: Record<string, WorkspacePoint>
}

interface ExternalFrame extends WorkspaceExternalCluster {
  position: WorkspacePoint
  size: WorkspaceSize
}

interface Rect {
  position: WorkspacePoint
  size: WorkspaceSize
}

const EXTERNAL_WIDTH = 216
const EXTERNAL_HEADER_HEIGHT = 48
const EXTERNAL_MEMBER_HEIGHT = 52
const EXTERNAL_FOOTER_HEIGHT = 12
const EXTERNAL_VERTICAL_GAP = 40

const EXTERNAL_NODE_PREFIX = 'workspace-external:'

export const workspaceExternalNodeId = (origin: string) =>
  `${EXTERNAL_NODE_PREFIX}${encodeURIComponent(origin)}`

/**
 * The origin an external frame stands for, or null for anything else on the canvas — a
 * member card included, whose id is `workspace-external-member:…` and does not carry the
 * frame prefix. The origin IS an external frame's whole record, so this is what a drag
 * writes its new position under.
 */
export function workspaceExternalOrigin(nodeId: string): string | null {
  if (!nodeId.startsWith(EXTERNAL_NODE_PREFIX)) return null
  return decodeURIComponent(nodeId.slice(EXTERNAL_NODE_PREFIX.length))
}

export const workspaceExternalMemberNodeId = (
  origin: string,
  name: string,
  definition?: WorkspaceExternalReference['definition'],
) =>
  `workspace-external-member:${encodeURIComponent(origin)}:${definition ? `${definition}:` : ''}${encodeURIComponent(name)}`

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.position.x < b.position.x + b.size.width + gap &&
    a.position.x + a.size.width + gap > b.position.x &&
    a.position.y < b.position.y + b.size.height + gap &&
    a.position.y + a.size.height + gap > b.position.y
  )
}

function initialPosition(
  frame: Omit<ExternalFrame, 'position'>,
  domainsById: Map<string, WorkspaceDomainFrame>,
  domainFrames: WorkspaceDomainFrame[],
  obstacles: Rect[],
): WorkspacePoint {
  const owners = frame.ownerDomainIds
    .map((domainId) => domainsById.get(domainId))
    .filter((domain): domain is WorkspaceDomainFrame => !!domain)
  const anchors = owners.length > 0 ? owners : domainFrames
  const x =
    anchors.reduce((right, domain) => Math.max(right, domain.position.x + domain.size.width), 0) +
    WORKSPACE_DOMAIN_GAP
  let y = anchors.reduce(
    (top, domain) => Math.min(top, domain.position.y),
    Number.POSITIVE_INFINITY,
  )
  if (!Number.isFinite(y)) y = 0

  while (true) {
    const candidate = { position: { x, y }, size: frame.size }
    const collision = obstacles.find((obstacle) =>
      overlaps(candidate, obstacle, EXTERNAL_VERTICAL_GAP),
    )
    if (!collision) return candidate.position
    y = collision.position.y + collision.size.height + EXTERNAL_VERTICAL_GAP
  }
}

function layoutExternalFrames(
  clusters: WorkspaceExternalCluster[],
  domainFrames: WorkspaceDomainFrame[],
  savedPositions: Record<string, WorkspacePoint>,
): ExternalFrame[] {
  const frames = [...clusters]
    .sort((a, b) => a.origin.localeCompare(b.origin))
    .map((cluster) => ({
      ...cluster,
      size: {
        width: EXTERNAL_WIDTH,
        height:
          EXTERNAL_HEADER_HEIGHT +
          cluster.members.length * EXTERNAL_MEMBER_HEIGHT +
          EXTERNAL_FOOTER_HEIGHT,
      },
    }))
  const domainsById = new Map(domainFrames.map((frame) => [frame.domainId, frame]))
  const obstacles: Rect[] = domainFrames.map(({ position, size }) => ({ position, size }))

  for (const frame of frames) {
    const position = savedPositions[frame.origin]
    if (position) obstacles.push({ position, size: frame.size })
  }

  return frames.map((frame) => {
    const saved = savedPositions[frame.origin]
    const position = saved ?? initialPosition(frame, domainsById, domainFrames, obstacles)
    if (!saved) obstacles.push({ position, size: frame.size })
    return { ...frame, position }
  })
}

export function projectExternalFrames(
  clusters: WorkspaceExternalCluster[],
  domainFrames: WorkspaceDomainFrame[],
  savedPositions: Record<string, WorkspacePoint>,
  catalog?: DomainCatalogEntry[],
): WorkspaceExternalProjection {
  const entriesByOrigin = new Map((catalog ?? []).map((entry) => [entry.origin, entry]))
  const frames = layoutExternalFrames(clusters, domainFrames, savedPositions)
  const nodes: Node[] = []

  for (const frame of frames) {
    const entry = entriesByOrigin.get(frame.origin)
    const domainId = workspaceExternalNodeId(frame.origin)
    const kind = frame.origin === 'kernel.astrale.ai' ? 'kernel' : 'external'
    nodes.push({
      id: domainId,
      type: 'extDomain',
      position: frame.position,
      // Furniture you move, exactly like a domain frame: grab it anywhere and drag it, and
      // its position is remembered under its origin. Not SELECTABLE, for the same reason a
      // domain frame is not — it is a place, not a thing you open.
      draggable: true,
      selectable: false,
      data: {
        name: entry?.name ?? frame.origin.split('.')[0],
        origin: frame.origin,
        kind,
        icon: entry?.icon,
      },
      style: frame.size,
    })
    frame.members.forEach((member, index) => {
      nodes.push({
        id: workspaceExternalMemberNodeId(frame.origin, member.name, member.definition),
        type: 'extMember',
        parentId: domainId,
        // A member rides with its frame. Unlike a class, it is not ours to place: the frame
        // is a fixed list whose height is that list's length, so a moved member would have
        // nowhere to be persisted and would snap back on the next projection. It is
        // therefore TRANSPARENT to the pointer — React Flow gives every node `pointer-events:
        // all` (the canvas has an `onNodeClick`), and a card that swallows the press would
        // leave a dead zone in the middle of the very block the reader is trying to drag.
        //
        // And for the same reason it carries no `extent: 'parent'`, natural as that would
        // look on a card that lives inside a box: there is no drag to bound. It was not
        // free, either — React Flow re-resolves an extent against a parent it has not
        // measured yet, so on the first frame after every repaint it painted the member at
        // its frame's own origin, dropping the offset below. One visible flash per drop,
        // and the only node on the canvas that had one.
        draggable: false,
        selectable: false,
        position: { x: 12, y: 42 + index * EXTERNAL_MEMBER_HEIGHT },
        data: { name: member.name, kind, definition: member.definition },
        style: { width: 192, height: 44, pointerEvents: 'none' },
      })
    })
  }

  return {
    nodes,
    positions: Object.fromEntries(frames.map((frame) => [frame.origin, frame.position])),
  }
}
