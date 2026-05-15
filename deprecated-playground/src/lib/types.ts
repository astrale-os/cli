export type LayoutDirection = 'TB' | 'LR'

export type Selection =
  | { type: 'schema-node'; id: string }
  | { type: 'schema-edge'; id: string }
  | { type: 'graph-node'; id: string }
  | { type: 'graph-edge'; id: string }
  | null

export interface ConsoleEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
  data?: unknown
}

export interface GraphStateNode {
  id: string
  labels?: string[]
  [key: string]: unknown
}

export interface GraphStateEdge {
  type: string
  src: string
  dest: string
  props?: Record<string, unknown>
}

export interface GraphStateData {
  nodes: GraphStateNode[]
  edges: GraphStateEdge[]
  timestamp: string
}
