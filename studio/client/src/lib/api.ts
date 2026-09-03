import type {
  AgentRun,
  AgentRunSnapshot,
  AgentSubmitResult,
  AgentSystemPromptInfo,
  AgentSessionInfo,
  AnchorRef,
  ChatInfo,
  ChatList,
  Comment,
  CommentStore,
  DocMeta,
  DomainCatalogEntry,
  DomainAnatomy,
  DomainSummary,
  AgentUsage,
  EnvFileModel,
  EnvName,
  HarnessGatewayConfig,
  HarnessGatewayState,
  HarnessLoadout,
  HarnessModelCatalog,
  HarnessStatus,
  InstancesState,
  IntrospectionStatus,
  StudioSettings,
  LayoutState,
  MergeResult,
  NodePosition,
  StaleReport,
  StudioCore,
  StudioDatasets,
  StudioSchemaBundle,
  ThreadEntry,
  ViewRuntime,
  ViewSessionResult,
  VisibilityState,
  WorkspaceUiState,
} from '@shared/types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${path}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const get = <T>(p: string) => req<T>(p)
const post = <T>(p: string, body: unknown) =>
  req<T>(p, { method: 'POST', body: JSON.stringify(body) })

const d = (id: string) => `/api/domain/${encodeURIComponent(id)}`

/** `?chat=<id>`, or nothing at all when the active tab is meant. */
function chatQuery(chatId?: string): string {
  return chatId ? `?chat=${encodeURIComponent(chatId)}` : ''
}

export const api = {
  workspace: () => get<DomainSummary[]>('/api/workspace'),
  workspaceState: () => get<WorkspaceUiState>('/api/workspace/state'),
  updateWorkspaceState: (
    state: Omit<WorkspaceUiState, 'readerDomainId'> & { readerDomainId: string | null },
  ) => post<WorkspaceUiState>('/api/workspace/state', { action: 'update', state }),
  createDomain: (name: string) =>
    post<{ ok: boolean; id?: string; origin?: string; error?: string; output: string }>(
      '/api/workspace/create',
      { name },
    ),
  catalog: () => get<DomainCatalogEntry[]>('/api/catalog'),
  instances: () => get<InstancesState>('/api/instances'),
  switchInstance: (name: string) =>
    post<{ ok: boolean; active: string | null; output: string }>('/api/instances/use', { name }),

  bundle: (id: string, priority: 'reader' | 'background' = 'reader') =>
    get<StudioSchemaBundle>(
      `${d(id)}/bundle${priority === 'background' ? '?priority=background' : ''}`,
    ),
  introspection: () => get<IntrospectionStatus>('/api/workspace/introspection'),
  core: (id: string) => get<StudioCore>(`${d(id)}/core`),
  anatomy: (id: string) => get<DomainAnatomy>(`${d(id)}/anatomy`),
  viewRuntime: (id: string, slug: string) =>
    get<ViewRuntime>(`${d(id)}/views/${encodeURIComponent(slug)}/runtime`),
  launchView: (id: string, slug: string, request: { targetId?: string }) =>
    post<ViewSessionResult>(`${d(id)}/views/${encodeURIComponent(slug)}/session`, request),
  closeViewSession: (id: string, sessionId: string) =>
    post<{ ok: true }>(`${d(id)}/views/sessions/close`, { sessionId }),
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
  /** run the message now, or park it behind the turn already running */
  agentSubmit: (message?: string, chatId?: string) =>
    post<AgentSubmitResult>('/api/agent/submit', {
      ...(message ? { message } : {}),
      ...(chatId ? { chatId } : {}),
    }),
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
  updateChat: (chatId: string, patch: { title?: string; model?: string; effort?: string }) =>
    post<ChatInfo>('/api/agent/chats', { action: 'update', chatId, ...patch }),
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
  // EMBED seam: relay a host-supplied delegation token to the server for `host`
  // auth mode. Called by the Astrale GUI glue when the studio runs as an iframe.
  pushHostToken: (token: string) =>
    post<{ ok: boolean }>('/api/agent/harness-gateway/host-token', { token }),
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
    const res = await fetch(`${d(id)}/context/documents`, { method: 'POST', body: fd })
    if (!res.ok) throw new Error(`${res.status} upload failed`)
    return (await res.json()) as DocMeta[]
  },
  deleteDocument: (id: string, docId: string) =>
    post<{ ok: boolean }>(`${d(id)}/context/documents/delete`, { id: docId }),
  updateDocument: (id: string, docId: string, content: string) =>
    post<DocMeta>(`${d(id)}/context/documents/update`, { id: docId, content }),
  docUrl: (id: string, docId: string) =>
    `${d(id)}/context/documents/${encodeURIComponent(docId)}/raw`,
  docContent: (id: string, docId: string) =>
    fetch(`${d(id)}/context/documents/${encodeURIComponent(docId)}/raw`).then((r) => r.text()),

  layout: (id: string) => get<LayoutState>(`${d(id)}/layout`),
  setLayout: (id: string, positions: Record<string, NodePosition>) =>
    post<LayoutState>(`${d(id)}/layout`, { action: 'set', positions }),
  resetLayout: (id: string) => post<{ ok: true }>(`${d(id)}/layout`, { action: 'reset' }),

  datasets: (id: string) => get<StudioDatasets>(`${d(id)}/datasets`),
  visibility: (id: string) => get<VisibilityState>(`${d(id)}/visibility`),
  setVisibility: (id: string, state: VisibilityState) =>
    post<VisibilityState>(`${d(id)}/visibility`, { action: 'set', ...state }),
}

export const qk = {
  workspace: ['workspace'] as const,
  workspaceState: ['workspace-state'] as const,
  catalog: ['catalog'] as const,
  instances: ['instances'] as const,
  bundle: (id: string) => ['bundle', id] as const,
  introspection: ['workspace-introspection'] as const,
  core: (id: string) => ['core', id] as const,
  datasets: (id: string) => ['datasets', id] as const,
  anatomy: (id: string) => ['anatomy', id] as const,
  viewRuntime: (id: string, slug: string) => ['view-runtime', id, slug] as const,
  updates: (id: string) => ['updates', id] as const,
  comments: (id: string) => ['comments', id] as const,
  settings: ['settings'] as const,
  layout: (id: string) => ['layout', id] as const,
  visibility: (id: string) => ['visibility', id] as const,
  documents: (id: string) => ['documents', id] as const,
  // Chat-scoped keys share one machine-wide prefix: invalidating `['agent']`
  // refreshes every open tab whatever workspace is on screen.
  agent: (chatId?: string) => (chatId ? (['agent', chatId] as const) : (['agent'] as const)),
  agentHistory: (chatId?: string) =>
    chatId ? (['agent-history', chatId] as const) : (['agent-history'] as const),
  agentSession: (chatId?: string) =>
    chatId ? (['agent-session', chatId] as const) : (['agent-session'] as const),
  agentSystemPrompt: ['agent-system-prompt'] as const,
  chats: ['chats'] as const,
  models: ['agent-models'] as const,
  harness: ['harness'] as const,
  harnessGateway: ['harness-gateway'] as const,
  loadout: (chatId?: string) => (chatId ? (['loadout', chatId] as const) : (['loadout'] as const)),
  usage: ['usage'] as const,
  env: (id: string, env: string) => ['env', id, env] as const,
}
