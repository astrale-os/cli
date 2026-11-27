import type {
  AgentRun,
  AgentRunSnapshot,
  AgentSubmitResult,
  AgentSystemPromptInfo,
  AgentSessionInfo,
  AgentToolCall,
  ChatAttachment,
  ChatInfo,
  ChatList,
  AgentUsage,
  HarnessGatewayConfig,
  HarnessGatewayState,
  HarnessLoadout,
  HarnessModelCatalog,
  HarnessStatus,
} from '@shared/contracts/agent'
import type {
  IntrospectionStatus,
  StudioSettings,
  StudioRuntime,
  StaleReport,
} from '@shared/contracts/runtime'
import type { Scenario, ScenarioStore } from '@shared/contracts/scenarios'
import type {
  DomainAnatomy,
  EnvFileModel,
  EnvName,
  StudioDatasets,
  StudioSchemaBundle,
  ViewRuntime,
  ViewSessionResult,
} from '@shared/contracts/schema'
import type {
  ChangeReport,
  CompatibilityMatrix,
  CompatibilityVerdict,
  DomainDependencies,
  DomainLocal,
  DomainStanding,
  PublishEvent,
  PublishRefusal,
  PublishRequest,
  RegistryDomains,
  RegistryIndex,
  Remote,
} from '@shared/contracts/versions'
import type {
  AnchorRef,
  Comment,
  CommentStore,
  DocMeta,
  DomainCatalogEntry,
  DomainSummary,
  InstanceDomains,
  InstancesState,
  LayoutState,
  MergeResult,
  NodePosition,
  ThreadEntry,
  WorkspaceUiState,
} from '@shared/contracts/workspace'

import { WORKSPACE_MAP_ID } from '@shared/contracts/workspace'

/** A route that answered an HTTP error: its status, and its body as it was sent. It reads as any
 *  other error does — `<status> <path>: <body>` — wherever it is only shown. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
    readonly body: string,
  ) {
    super(`${status} ${path}: ${body}`)
  }
}

/** An `ApiError`'s body as the JSON object a route answered, when it is one. */
function answerOf(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof ApiError)) return undefined
  try {
    const body: unknown = JSON.parse(error.body)
    return body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** A Studio state file a route could not read whole, and so left as it is: where, and why. */
export interface UnreadableFile {
  readonly path: string
  readonly reason: string
  /** the route's sentence: the file, why, and what to do */
  readonly sentence: string
}

/** The state file a read or a write was refused over, when it was refused over one. */
export function unreadableOf(error: unknown): UnreadableFile | undefined {
  const answer = answerOf(error)
  const unreadable = answer?.unreadable as Record<string, unknown> | undefined
  if (error instanceof ApiError && error.status === 409 && unreadable)
    if (typeof unreadable.path === 'string' && typeof unreadable.reason === 'string')
      return {
        path: unreadable.path,
        reason: unreadable.reason,
        sentence: typeof answer?.error === 'string' ? answer.error : unreadable.reason,
      }
  return undefined
}

/** Whether a write was refused because it was made from a revision the store has moved past. */
export const isStale = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 409 && answerOf(error)?.stale === true

/** The sentence a route refused with, else the error's own message. */
export function refusalOf(error: unknown): string {
  const said = answerOf(error)?.error
  if (typeof said === 'string') return said
  return error instanceof Error ? error.message : String(error)
}

/** Ids added to one lens's set and ids removed from it; the others keep what they had. */
export interface LensSetChange {
  readonly add: readonly string[]
  readonly remove: readonly string[]
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, path, text)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const get = <T>(p: string) => req<T>(p)
const post = <T>(p: string, body: unknown) =>
  req<T>(p, { method: 'POST', body: JSON.stringify(body) })

const d = (id: string) => `/api/domain/${encodeURIComponent(id)}`

/** Where a layout record is kept: a Domain's own, or the Workspace map's, which names none. */
const layoutPath = (id: string) =>
  id === WORKSPACE_MAP_ID ? '/api/workspace/layout' : `${d(id)}/layout`

/** `?chat=<id>`, or nothing at all when the active tab is meant. */
function chatQuery(chatId?: string): string {
  return chatId ? `?chat=${encodeURIComponent(chatId)}` : ''
}

const attachmentPath = (chatId: string, id: string) =>
  `/api/agent/attachments/${encodeURIComponent(id)}${chatQuery(chatId)}`

const docRawPath = (id: string, docId: string) =>
  `${d(id)}/context/documents/${encodeURIComponent(docId)}/raw`

export const api = {
  workspace: () => get<DomainSummary[]>('/api/workspace'),
  studioRuntime: () => get<StudioRuntime>('/api/workspace/runtime'),
  refreshWorkspace: () => post<{ refreshed: number }>('/api/workspace/refresh', {}),
  workspaceState: () => get<WorkspaceUiState>('/api/workspace/state'),
  updateWorkspaceState: (
    state: Omit<WorkspaceUiState, 'readerDomainId'> & { readerDomainId?: string | null },
  ) => post<WorkspaceUiState>('/api/workspace/state', { action: 'update', state }),
  createDomain: (name: string) =>
    post<{ ok: boolean; id?: string; origin?: string; error?: string; output: string }>(
      '/api/workspace/create',
      { name },
    ),
  catalog: () => get<DomainCatalogEntry[]>('/api/catalog'),
  instances: () => get<InstancesState>('/api/instances'),
  instanceDomains: (name: string) =>
    get<InstanceDomains>(`/api/instances/domains?name=${encodeURIComponent(name)}`),
  switchInstance: (name: string) =>
    post<{ ok: boolean; active: string | null; output: string }>('/api/instances/use', { name }),

  /** `fresh` asks a Publication's registry again instead of the kept answer. */
  bundle: (id: string, priority: 'reader' | 'background' = 'reader', fresh?: boolean) =>
    get<StudioSchemaBundle>(
      withQuery(
        `${d(id)}/bundle`,
        priority === 'background' ? 'priority=background' : '',
        freshQuery(fresh),
      ),
    ),
  introspection: () => get<IntrospectionStatus>('/api/workspace/introspection'),
  anatomy: (id: string) => get<DomainAnatomy>(`${d(id)}/anatomy`),
  viewRuntime: (id: string, slug: string) =>
    get<ViewRuntime>(`${d(id)}/views/${encodeURIComponent(slug)}/runtime`),
  launchView: (id: string, slug: string, request: { preparationId: string }) =>
    post<ViewSessionResult>(`${d(id)}/views/${encodeURIComponent(slug)}/session`, request),
  releaseViewSession: (id: string, sessionId: string, page: string) =>
    post<{ ok: true }>(`${d(id)}/views/sessions/release`, { sessionId, page }),
  updates: (id: string) => get<StaleReport>(`${d(id)}/updates`),

  comments: (id: string) => get<CommentStore>(`${d(id)}/comments`),
  createComment: (
    id: string,
    body: {
      anchors: string[]
      anchorRefs: AnchorRef[]
      text: string
      firstRole?: 'user' | 'author'
      type?: 'text' | 'choice'
      options?: string[]
    },
  ) => post<Comment>(`${d(id)}/comments`, { action: 'create', ...body }),
  replyComment: (id: string, commentId: string, entry: Omit<ThreadEntry, 'id'>) =>
    post<Comment>(`${d(id)}/comments`, { action: 'reply', id: commentId, entry }),
  setCommentStatus: (
    id: string,
    commentId: string,
    status: 'open' | 'closed',
    closeNote?: string,
  ) => post<Comment>(`${d(id)}/comments`, { action: 'status', id: commentId, status, closeNote }),
  deleteComment: (id: string, commentId: string) =>
    post<{ ok: true }>(`${d(id)}/comments`, { action: 'delete', id: commentId }),
  mergeReply: (id: string, text: string) => post<MergeResult>(`${d(id)}/comments/merge`, { text }),

  /** Machine-wide, not per domain or workspace. */
  settings: () => get<StudioSettings>('/api/settings'),
  updateSettings: (settings: Partial<StudioSettings>) =>
    post<StudioSettings>('/api/settings', { action: 'update', settings }),

  // Every conversation call names its chat tab; omitting it means the active one.
  agentSnapshot: (chatId?: string) => get<AgentRunSnapshot>(`/api/agent${chatQuery(chatId)}`),
  /** every terminal turn one chat kept, oldest first — its transcript */
  agentHistory: (chatId?: string) => get<AgentRun[]>(`/api/agent/history${chatQuery(chatId)}`),
  /** what one tool call of a turn was given and gave back - read when its step is opened */
  agentToolCall: (chatId: string, runId: string, eventId: string) =>
    get<AgentToolCall>(
      `/api/agent/tool-call?${new URLSearchParams({ chat: chatId, run: runId, event: eventId })}`,
    ),
  /**
   * Run the message now, or park it behind the turn already running. `comments` are the
   * open threads the turn carries — none unless named, `'all'` for every one;
   * `attachments` are the ids of images already uploaded to this chat, in order.
   */
  agentSubmit: (
    message?: string,
    chatId?: string,
    comments?: 'all' | string[],
    attachments?: string[],
  ) =>
    post<AgentSubmitResult>('/api/agent/submit', {
      ...(message ? { message } : {}),
      ...(chatId ? { chatId } : {}),
      ...(comments === 'all' || comments?.length ? { comments } : {}),
      ...(attachments?.length ? { attachments } : {}),
    }),
  /** keep one image with a chat, before the message it goes with is sent */
  uploadAttachment: async (chatId: string, file: Blob, name: string) => {
    const form = new FormData()
    form.append('file', file, name)
    const res = await fetch(`/api/agent/attachments${chatQuery(chatId)}`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined
      throw new Error(body?.error ?? `${res.status} upload failed`)
    }
    return (await res.json()) as ChatAttachment
  },
  deleteAttachment: (chatId: string, id: string) =>
    req<{ ok: boolean }>(attachmentPath(chatId, id), { method: 'DELETE' }),
  attachmentUrl: attachmentPath,
  // seamless continue after an interruption — resumes the live session with a bare nudge (no re-briefing)
  agentResume: (chatId?: string) =>
    post<AgentSubmitResult>('/api/agent/submit', {
      resume: true,
      ...(chatId ? { chatId } : {}),
    }),
  /** the waiting messages of one chat — each call answers with the tab as it stands */
  editQueued: (chatId: string, messageId: string, message: string) =>
    post<ChatInfo>('/api/agent/queue', { action: 'edit', chatId, id: messageId, message }),
  removeQueued: (chatId: string, messageId: string) =>
    post<ChatInfo>('/api/agent/queue', { action: 'remove', chatId, id: messageId }),
  moveQueued: (chatId: string, messageId: string, direction: 'up' | 'down') =>
    post<ChatInfo>('/api/agent/queue', { action: 'move', chatId, id: messageId, direction }),
  /** jump one waiting message to the front, stopping the turn in progress for it */
  sendQueued: (chatId: string, messageId: string) =>
    post<AgentSubmitResult>('/api/agent/queue', { action: 'send', chatId, id: messageId }),
  agentCancel: (chatId?: string) =>
    post<{ ok: boolean }>('/api/agent/cancel', chatId ? { chatId } : {}),
  agentSession: (chatId?: string) =>
    get<AgentSessionInfo>(`/api/agent/session${chatQuery(chatId)}`),
  setAgentSession: (harness: string, sessionId: string, chatId?: string) =>
    post<AgentSessionInfo>('/api/agent/session', {
      harness,
      sessionId,
      ...(chatId ? { chatId } : {}),
    }),
  agentSystemPrompt: () => get<AgentSystemPromptInfo>('/api/agent/prompt/system'),

  chats: () => get<ChatList>('/api/agent/chats'),
  openChat: (harness?: string, newDomainId?: string) =>
    post<ChatInfo>('/api/agent/chats', {
      action: 'open',
      ...(harness ? { harness } : {}),
      ...(newDomainId ? { newDomainId } : {}),
    }),
  selectChat: (chatId: string) => post<ChatList>('/api/agent/chats', { action: 'select', chatId }),
  closeChat: (chatId: string) => post<ChatList>('/api/agent/chats', { action: 'close', chatId }),
  /** arrange the tabs; tabs `order` leaves out keep their place after the named ones */
  reorderChats: (order: string[]) =>
    post<ChatList>('/api/agent/chats', { action: 'reorder', order }),
  updateChat: (
    chatId: string,
    patch: { title?: string; model?: string; effort?: string; fastMode?: boolean },
  ) => post<ChatInfo>('/api/agent/chats', { action: 'update', chatId, ...patch }),
  /** fork this chat onto the other agent, carrying a summary of it */
  switchChatHarness: (chatId: string, harness: string, model?: string) =>
    post<ChatInfo>('/api/agent/chats', {
      action: 'switch-harness',
      chatId,
      harness,
      ...(model ? { model } : {}),
    }),
  /** drop an unsent fork summary — delivered conversation context is immutable */
  forgetChatOrigin: (chatId: string) =>
    post<ChatInfo>('/api/agent/chats', { action: 'forget-origin', chatId }),

  harness: () => get<HarnessStatus>('/api/agent/harness'),
  /** every harness's selectable models — what the composer's picker offers */
  models: () => get<HarnessModelCatalog[]>('/api/agent/models'),
  harnessGateway: () => get<HarnessGatewayState>('/api/agent/harness-gateway'),
  setHarnessGateway: (config: HarnessGatewayConfig) =>
    post<HarnessGatewayState>('/api/agent/harness-gateway', { action: 'set', config }),
  clearHarnessGateway: () =>
    post<HarnessGatewayState>('/api/agent/harness-gateway', { action: 'clear' }),
  loadout: (refresh = false, chatId?: string) =>
    get<HarnessLoadout>(
      `/api/agent/loadout?${new URLSearchParams({
        ...(refresh ? { refresh: '1' } : {}),
        ...(chatId ? { chat: chatId } : {}),
      })}`,
    ),
  usage: () => get<AgentUsage>('/api/agent/usage'),

  env: (id: string, env: EnvName) => get<EnvFileModel>(`${d(id)}/env?env=${env}`),
  setEnv: (id: string, env: EnvName, updates: Record<string, string | null>) =>
    post<EnvFileModel>(`${d(id)}/env`, { env, updates }),

  documents: (id: string) => get<DocMeta[]>(`${d(id)}/context/documents`),
  uploadDocuments: async (id: string, files: File[]) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    const path = `${d(id)}/context/documents`
    const res = await fetch(path, { method: 'POST', body: fd })
    if (!res.ok) throw new ApiError(res.status, path, await res.text().catch(() => res.statusText))
    return (await res.json()) as DocMeta[]
  },
  deleteDocument: (id: string, docId: string) =>
    post<{ ok: boolean }>(`${d(id)}/context/documents/delete`, { id: docId }),
  updateDocument: (id: string, docId: string, content: string) =>
    post<DocMeta>(`${d(id)}/context/documents/update`, { id: docId, content }),
  docUrl: docRawPath,
  docContent: (id: string, docId: string) => fetch(docRawPath(id, docId)).then((r) => r.text()),

  /** The layout record of a Domain, or of the Workspace map (`WORKSPACE_MAP_ID`). */
  layout: (id: string) => get<LayoutState>(layoutPath(id)),
  /** Merges positions into one lens's arrangement. */
  setLensLayout: (id: string, lens: string, positions: Record<string, NodePosition>) =>
    post<LayoutState>(layoutPath(id), { action: 'set', lens, positions }),
  /** Forgets one lens's arrangement. */
  resetLensLayout: (id: string, lens: string) =>
    post<LayoutState>(layoutPath(id), { action: 'reset', lens }),
  /** Shuts some of one lens's modules and opens others; every module not named keeps its state. */
  changeLensCollapsed: (id: string, lens: string, change: LensSetChange) =>
    post<LayoutState>(layoutPath(id), { action: 'collapse', lens, ...change }),
  /** Opens some of one lens's folds by hand and shuts others; every fold not named keeps its state. */
  changeLensOpened: (id: string, lens: string, change: LensSetChange) =>
    post<LayoutState>(layoutPath(id), { action: 'open', lens, ...change }),

  datasets: (id: string) => get<StudioDatasets>(`${d(id)}/datasets`),

  /** Every Scenario of a Domain, whatever its dataset. */
  scenarios: (id: string) => get<ScenarioStore>(`${d(id)}/scenarios`),
  /** Puts a Scenario whole — added, or in place of the one with its id — made from `revision`. */
  putScenario: (id: string, scenario: Scenario, revision: number) =>
    post<ScenarioStore>(`${d(id)}/scenarios`, { action: 'put', scenario, revision }),
  deleteScenario: (id: string, scenarioId: string, revision: number) =>
    post<ScenarioStore>(`${d(id)}/scenarios`, { action: 'delete', id: scenarioId, revision }),
}

export const qk = {
  workspace: ['workspace'] as const,
  studioRuntime: ['studio-runtime'] as const,
  workspaceState: ['workspace-state'] as const,
  catalog: ['catalog'] as const,
  instances: ['instances'] as const,
  instanceDomains: (name: string) => ['instance-domains', name] as const,
  bundle: (id: string) => ['bundle', id] as const,
  introspection: ['workspace-introspection'] as const,
  datasets: (id: string) => ['datasets', id] as const,
  anatomy: (id: string) => ['anatomy', id] as const,
  viewRuntime: (id: string, slug: string) => ['view-runtime', id, slug] as const,
  updates: (id: string) => ['updates', id] as const,
  comments: (id: string) => ['comments', id] as const,
  settings: ['settings'] as const,
  layout: (id: string) => ['layout', id] as const,
  scenarios: (id: string) => ['scenarios', id] as const,
  documents: (id: string) => ['documents', id] as const,
  // Chat-scoped keys share one machine-wide prefix: invalidating `['agent']`
  // refreshes every open tab whatever workspace is on screen.
  agent: (chatId?: string) => (chatId ? (['agent', chatId] as const) : (['agent'] as const)),
  agentHistory: (chatId?: string) =>
    chatId ? (['agent-history', chatId] as const) : (['agent-history'] as const),
  agentSession: (chatId?: string) =>
    chatId ? (['agent-session', chatId] as const) : (['agent-session'] as const),
  agentSystemPrompt: ['agent-system-prompt'] as const,
  /** one revision of a tool call's details: a revision never changes once read */
  agentToolCall: (runId: string, eventId: string, revision: number) =>
    ['agent-tool-call', runId, eventId, revision] as const,
  chats: ['chats'] as const,
  models: ['agent-models'] as const,
  harness: ['harness'] as const,
  harnessGateway: ['harness-gateway'] as const,
  loadout: (chatId?: string) => (chatId ? (['loadout', chatId] as const) : (['loadout'] as const)),
  usage: ['usage'] as const,
  env: (id: string, env: string) => ['env', id, env] as const,
}

const freshQuery = (fresh?: boolean) => (fresh ? 'fresh=1' : '')
const withQuery = (path: string, ...parts: string[]) => {
  const query = parts.filter(Boolean).join('&')
  return query ? `${path}?${query}` : path
}
const param = (name: string, value: string) => `${name}=${encodeURIComponent(value)}`

/** Workspace level: versions, changes, dependencies, compatibility, the registry and Publish. */
export const versionsApi = {
  /** Every workspace Domain on disk; never waits on the network. */
  locals: () => get<DomainLocal[]>('/api/versions'),
  standing: (id: string, fresh?: boolean) =>
    get<DomainStanding>(withQuery(`${d(id)}/versions`, freshQuery(fresh))),
  changes: (id: string, fresh?: boolean) =>
    get<Remote<ChangeReport>>(withQuery(`${d(id)}/versions/changes`, freshQuery(fresh))),
  dependencies: (id: string, fresh?: boolean) =>
    get<DomainDependencies>(withQuery(`${d(id)}/versions/dependencies`, freshQuery(fresh))),
  compatibility: (id: string, fresh?: boolean) =>
    get<CompatibilityMatrix>(withQuery(`${d(id)}/versions/compatibility`, freshQuery(fresh))),
  /** One verdict: against a published `version` of `origin`, or its workspace copy. */
  verdict: (id: string, origin: string, target: { version: string } | { local: true }) =>
    get<Remote<CompatibilityVerdict>>(
      withQuery(
        `${d(id)}/versions/compatibility`,
        param('origin', origin),
        'version' in target ? param('version', target.version) : 'local=1',
      ),
    ),
  registryDomains: () => get<Remote<RegistryDomains>>('/api/registry/domains'),
  registryVersions: (origin: string, fresh?: boolean) =>
    get<Remote<RegistryIndex>>(
      withQuery('/api/registry/versions', param('origin', origin), freshQuery(fresh)),
    ),
  /**
   * Publish, relaying every event as it arrives. Resolves with the refusal when nothing ran, or
   * with the final `result` event.
   */
  publish: async (
    id: string,
    request: PublishRequest,
    onEvent: (event: PublishEvent) => void,
  ): Promise<
    { refused: PublishRefusal } | { result: Extract<PublishEvent, { type: 'result' }> }
  > => {
    const res = await fetch(`${d(id)}/versions/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!res.ok) return { refused: (await res.json()) as PublishRefusal }
    if (!res.body) throw new Error('Publish answered no event stream.')
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffered = ''
    let result: Extract<PublishEvent, { type: 'result' }> | undefined
    for (;;) {
      const { value, done } = await reader.read()
      if (value) buffered += value
      const lines = buffered.split('\n')
      buffered = done ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as PublishEvent
        if (event.type === 'result') result = event
        onEvent(event)
      }
      if (done) break
    }
    if (!result) throw new Error('The Publish stream ended without a result.')
    return { result }
  },
}

export const versionsKeys = {
  /** Every versions fact: the keys below, the registry's aside. */
  all: ['versions'] as const,
  locals: ['versions', 'locals'] as const,
  standing: (id: string) => ['versions', 'standing', id] as const,
  changes: (id: string) => ['versions', 'changes', id] as const,
  dependencies: (id: string) => ['versions', 'dependencies', id] as const,
  compatibility: (id: string) => ['versions', 'compatibility', id] as const,
  verdict: (id: string, origin: string, target: string) =>
    ['versions', 'verdict', id, origin, target] as const,
  /** Every registry fact: its Domains and their Publications. A Publication's Schema is a
   *  Domain's bundle, under its Publication id. */
  registry: ['registry'] as const,
  registryDomains: ['registry', 'domains'] as const,
  registryVersions: (origin: string) => ['registry', 'versions', origin] as const,
}
