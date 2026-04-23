import {
  createContext,
  useReducer,
  useCallback,
  useEffect,
  useContext,
  type ReactNode,
} from 'react'

import type { Selection, ConsoleEntry, GraphStateData } from '@/lib/types'
import type { OpCallResult } from '@/tools/operations/components/op-form'
import type { OpEntry } from '@/tools/operations/lib/op-registry'

import { ConnectionContext } from '@/providers/connection'
import { graphStateToSchema } from '@/tools/schema/lib/graph-state-to-schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = Record<string, any>

export type WorkbenchTab = 'operations' | 'query' | 'console'
export type CanvasMode = 'graph' | 'schema' | 'filesystem'

export interface NodePickerRequest {
  fieldKey: string
  resolve: (nodeId: string) => void
}

export interface WorkspaceState {
  schema: AnySchema | null
  selection: Selection
  canvasMode: CanvasMode
  panels: { inspector: boolean; workbench: boolean }
  activeTab: WorkbenchTab
  selectedOp: OpEntry | null
  opResult: OpCallResult | null
  consoleLogs: ConsoleEntry[]
  graphState: GraphStateData | null
  graphStateLoading: boolean
  graphStateError: string | null
  nodePicker: NodePickerRequest | null
}

type Action =
  | { type: 'SET_SCHEMA'; schema: AnySchema | null }
  | { type: 'SET_SELECTION'; selection: Selection }
  | { type: 'TOGGLE_PANEL'; panel: 'inspector' | 'workbench' }
  | { type: 'SET_PANEL'; panel: 'inspector' | 'workbench'; open: boolean }
  | { type: 'SET_ACTIVE_TAB'; tab: WorkbenchTab }
  | { type: 'SET_SELECTED_OP'; op: OpEntry | null }
  | { type: 'SET_OP_RESULT'; result: OpCallResult | null }
  | { type: 'APPEND_LOG'; entry: ConsoleEntry }
  | { type: 'CLEAR_LOGS' }
  | { type: 'SET_GRAPH_STATE'; data: GraphStateData | null }
  | { type: 'SET_GRAPH_STATE_LOADING'; loading: boolean }
  | { type: 'SET_GRAPH_STATE_ERROR'; error: string | null }
  | { type: 'SET_CANVAS_MODE'; mode: CanvasMode }
  | { type: 'SET_NODE_PICKER'; picker: NodePickerRequest | null }

const initialState: WorkspaceState = {
  schema: null,
  selection: null,
  canvasMode: 'graph',
  panels: { inspector: true, workbench: true },
  activeTab: 'operations',
  selectedOp: null,
  opResult: null,
  consoleLogs: [],
  graphState: null,
  graphStateLoading: false,
  graphStateError: null,
  nodePicker: null,
}

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case 'SET_SCHEMA':
      return { ...state, schema: action.schema, selection: null }
    case 'SET_SELECTION':
      return { ...state, selection: action.selection }
    case 'TOGGLE_PANEL':
      return { ...state, panels: { ...state.panels, [action.panel]: !state.panels[action.panel] } }
    case 'SET_PANEL':
      return { ...state, panels: { ...state.panels, [action.panel]: action.open } }
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.tab }
    case 'SET_SELECTED_OP':
      return { ...state, selectedOp: action.op, opResult: null }
    case 'SET_OP_RESULT':
      return { ...state, opResult: action.result }
    case 'APPEND_LOG':
      return { ...state, consoleLogs: [...state.consoleLogs, action.entry] }
    case 'CLEAR_LOGS':
      return { ...state, consoleLogs: [] }
    case 'SET_GRAPH_STATE':
      return { ...state, graphState: action.data }
    case 'SET_GRAPH_STATE_LOADING':
      return { ...state, graphStateLoading: action.loading }
    case 'SET_GRAPH_STATE_ERROR':
      return { ...state, graphStateError: action.error }
    case 'SET_CANVAS_MODE':
      return { ...state, canvasMode: action.mode, selection: null }
    case 'SET_NODE_PICKER':
      return { ...state, nodePicker: action.picker }
    default:
      return state
  }
}

export interface WorkspaceActions {
  setSchema: (schema: AnySchema | null) => void
  setSelection: (selection: Selection) => void
  togglePanel: (panel: 'inspector' | 'workbench') => void
  setPanel: (panel: 'inspector' | 'workbench', open: boolean) => void
  setActiveTab: (tab: WorkbenchTab) => void
  setSelectedOp: (op: OpEntry | null) => void
  setOpResult: (result: OpCallResult | null) => void
  appendLog: (entry: ConsoleEntry) => void
  clearLogs: () => void
  setGraphState: (data: GraphStateData | null) => void
  setGraphStateLoading: (loading: boolean) => void
  setGraphStateError: (error: string | null) => void
  setCanvasMode: (mode: CanvasMode) => void
  refreshGraphState: () => void
  startNodePicker: (fieldKey: string, resolve: (nodeId: string) => void) => void
  cancelNodePicker: () => void
}

export type WorkspaceContextValue = WorkspaceState & WorkspaceActions

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

// `getTree` returns Path-like strings for node/edge classes
// (`/:domain:class.Foo`). We strip the qualified prefix back to the bare
// class name so the existing graph-state shape stays consumer-friendly.
function classNameFromPath(classPath: string | undefined): string {
  if (!classPath) return 'unknown'
  // Last segment after the trailing colon, minus optional `class.`/`interface.`
  const last = classPath.split(':').pop() ?? classPath
  return last.replace(/^(class|interface)\./, '')
}

// Fully-qualified property keys look like "<domain>:interface.<Iface>.property.<name>".
const PROP_KEY_RE = /^[^:]+:interface\.([^.]+)\.property\.(.+)$/

function parseClassPath(
  p: string | undefined,
): { domain: string; kind: 'class' | 'interface'; name: string } | null {
  if (!p) return null
  // "/:<domain>:<class|interface>.<Name>"
  const m = p.match(/^\/:([^:]+):(class|interface)\.(.+)$/)
  if (!m) return null
  return { domain: m[1], kind: m[2] as 'class' | 'interface', name: m[3] }
}

function propByName(
  props: Record<string, unknown> | undefined,
  iface: string,
  name: string,
): unknown {
  if (!props) return undefined
  for (const [k, v] of Object.entries(props)) {
    const m = k.match(PROP_KEY_RE)
    if (m && m[1] === iface && m[2] === name) return v
  }
  return undefined
}

function flattenBareProps(props: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!props) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    const m = k.match(PROP_KEY_RE)
    if (m) out[m[2]] = v
  }
  return out
}

type GetTreeNode = {
  id: string
  class?: string
  path?: string
  __labels?: string[]
  props?: Record<string, unknown>
}

type GetTreeEdge = {
  id?: string
  class?: string
  slug?: string
  source: string
  target: string
  props?: Record<string, unknown>
}

function kernelTreeToGraphState(result: {
  nodes: GetTreeNode[]
  edges: GetTreeEdge[]
}): GraphStateData {
  // Index meta-nodes: for every Class/Interface node, map its logical
  // abstract path (e.g. "/<domain>/class.Foo/self") → node.id, and also
  // its bare name → node.id for fallback lookup.
  const classNodeIdByPath = new Map<string, string>()
  const classNodeIdByName = new Map<string, string>()
  for (const n of result.nodes) {
    const parsed = parseClassPath(n.class)
    if (!parsed) continue
    // We only care about meta-nodes that ARE Classes or Interfaces.
    // The `class` field of a Class node itself is /:kernel.astrale.ai:class.Class;
    // the `class` field of an Interface meta-node is .class.Interface.
    if (!(parsed.name === 'Class' || parsed.name === 'Interface')) continue
    if (!n.path) continue
    classNodeIdByPath.set(n.path, n.id)
    // The final segment before `/self` is the meta-node's own class.<Name>
    // or interface.<Name> slug. Extract the short name for the name index.
    const segments = n.path.split('/').filter(Boolean)
    const meaningful =
      segments[segments.length - 1] === 'self'
        ? segments[segments.length - 2]
        : segments[segments.length - 1]
    const shortName = meaningful?.replace(/^(class|interface)\./, '')
    if (shortName) classNodeIdByName.set(shortName, n.id)
  }

  // Path → node UUID. Wire edges reference endpoints by absolute path
  // (new format), but downstream code keys everything by node.id.
  const nodeIdByPath = new Map<string, string>()
  for (const n of result.nodes) {
    if (n.path) nodeIdByPath.set(n.path, n.id)
  }
  const toNodeId = (pathOrId: string): string => nodeIdByPath.get(pathOrId) ?? pathOrId

  // Harvest slug per node from incoming has_parent edges. The slug on a
  // has_parent edge = the child's own path segment in the parent.
  const slugByNodeId = new Map<string, string>()
  for (const e of result.edges) {
    if (classNameFromPath(e.class) !== 'has_parent') continue
    if (e.slug !== undefined && e.slug !== null) slugByNodeId.set(toNodeId(e.source), e.slug)
  }

  // Resolve a node's `class` ClassPath → Class node UUID (used by
  // raw-to-business.ts to key into classNodeIndex).
  function resolveClassId(classPath: string | undefined): string | null {
    const parsed = parseClassPath(classPath)
    if (!parsed) return null
    const abstractPath = `/${parsed.domain}/${parsed.kind}.${parsed.name}/self`
    return classNodeIdByPath.get(abstractPath) ?? classNodeIdByName.get(parsed.name) ?? null
  }

  return {
    nodes: result.nodes.map((n) => ({
      // Short-form keys the legacy downstream code reads:
      ...flattenBareProps(n.props),
      // Raw qualified props so inspectors can still show full-fidelity data:
      ...n.props,
      id: n.id,
      labels: n.__labels ?? [],
      name: (propByName(n.props, 'Named', 'name') as string | undefined) ?? null,
      slug: slugByNodeId.get(n.id) ?? null,
      path: n.path ?? null,
      classId: resolveClassId(n.class),
      type: n.props?.type as 'edge' | 'node' | undefined,
    })),
    edges: result.edges.map((e) => ({
      type: classNameFromPath(e.class),
      src: toNodeId(e.source),
      dest: toNodeId(e.target),
      props: { ...e.props, ...(e.slug !== undefined && e.slug !== null ? { slug: e.slug } : {}) },
    })),
    timestamp: new Date().toISOString(),
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const connection = useContext(ConnectionContext)

  const refreshGraphState = useCallback(async () => {
    if (!connection) return
    dispatch({ type: 'SET_GRAPH_STATE_LOADING', loading: true })
    dispatch({ type: 'SET_GRAPH_STATE_ERROR', error: null })
    try {
      // `@__system__` addresses the root node; `::getTree` is the sealed
      // instance method on `kernel.astrale.ai:Node`. Depth/cap match the
      // adapter defaults — overflow surfaces as a KERNEL_ERROR partial.
      const tree = await connection.call<{ nodes: GetTreeNode[]; edges: GetTreeEdge[] }>(
        '@__system__::getTree',
        { depth: 10, maxNodes: 10_000 },
      )
      dispatch({ type: 'SET_GRAPH_STATE', data: kernelTreeToGraphState(tree) })
    } catch (e: unknown) {
      dispatch({
        type: 'SET_GRAPH_STATE_ERROR',
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      dispatch({ type: 'SET_GRAPH_STATE_LOADING', loading: false })
    }
  }, [connection])

  const actions: WorkspaceActions = {
    setSchema: useCallback((schema) => dispatch({ type: 'SET_SCHEMA', schema }), []),
    setSelection: useCallback((selection) => dispatch({ type: 'SET_SELECTION', selection }), []),
    togglePanel: useCallback((panel) => dispatch({ type: 'TOGGLE_PANEL', panel }), []),
    setPanel: useCallback((panel, open) => dispatch({ type: 'SET_PANEL', panel, open }), []),
    setActiveTab: useCallback((tab) => dispatch({ type: 'SET_ACTIVE_TAB', tab }), []),
    setSelectedOp: useCallback((op) => dispatch({ type: 'SET_SELECTED_OP', op }), []),
    setOpResult: useCallback((result) => dispatch({ type: 'SET_OP_RESULT', result }), []),
    appendLog: useCallback((entry) => dispatch({ type: 'APPEND_LOG', entry }), []),
    clearLogs: useCallback(() => dispatch({ type: 'CLEAR_LOGS' }), []),
    setGraphState: useCallback((data) => dispatch({ type: 'SET_GRAPH_STATE', data }), []),
    setGraphStateLoading: useCallback(
      (loading) => dispatch({ type: 'SET_GRAPH_STATE_LOADING', loading }),
      [],
    ),
    setGraphStateError: useCallback(
      (error) => dispatch({ type: 'SET_GRAPH_STATE_ERROR', error }),
      [],
    ),
    setCanvasMode: useCallback((mode) => dispatch({ type: 'SET_CANVAS_MODE', mode }), []),
    refreshGraphState,
    startNodePicker: useCallback((fieldKey: string, resolve: (nodeId: string) => void) => {
      dispatch({ type: 'SET_NODE_PICKER', picker: { fieldKey, resolve } })
    }, []),
    cancelNodePicker: useCallback(() => dispatch({ type: 'SET_NODE_PICKER', picker: null }), []),
  }

  useEffect(() => {
    if (!state.graphState) return
    const derived = graphStateToSchema(state.graphState)
    if (derived) dispatch({ type: 'SET_SCHEMA', schema: derived as AnySchema })
  }, [state.graphState])

  useEffect(() => {
    if (connection?.status === 'connected') {
      refreshGraphState()
    }
  }, [connection?.status, refreshGraphState])

  return (
    <WorkspaceContext.Provider value={{ ...state, ...actions }}>
      {children}
    </WorkspaceContext.Provider>
  )
}
