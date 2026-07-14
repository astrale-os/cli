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
  definition: 'class' | 'interface'
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

export const workspaceExternalNodeId = (origin: string) =>
  `workspace-external:${encodeURIComponent(origin)}`

export const workspaceExternalMemberNodeId = (origin: string, name: string) =>
  `workspace-external-member:${encodeURIComponent(origin)}:${encodeURIComponent(name)}`

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
      draggable: false,
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
        id: workspaceExternalMemberNodeId(frame.origin, member.name),
        type: 'extMember',
        parentId: domainId,
        extent: 'parent',
        draggable: false,
        position: { x: 12, y: 42 + index * EXTERNAL_MEMBER_HEIGHT },
        data: { name: member.name, kind, definition: member.definition },
        style: { width: 192, height: 44 },
      })
    })
  }

  return {
    nodes,
    positions: Object.fromEntries(frames.map((frame) => [frame.origin, frame.position])),
  }
}
