import type { StudioCore, StudioDataset, StudioDatasetFailure } from '@shared/types'

export function isReadyDataset(
  entry: StudioDataset | StudioDatasetFailure | undefined,
): entry is StudioDataset {
  return entry?.status === 'ready'
}

export function datasetLabel(dataset: Pick<StudioDataset, 'id' | 'title'>): string {
  return dataset.title?.trim() || dataset.id
}

/**
 * A Dataset read as Core data: the canvas, tree rows and detail panel already draw exactly
 * this shape, so demo facts reuse them instead of growing a second renderer.
 */
export function datasetCore(dataset: StudioDataset): StudioCore {
  return {
    domain: dataset.origin,
    nodes: dataset.nodes,
    edges: dataset.edges,
    error: null,
    extractedAt: '',
  }
}
