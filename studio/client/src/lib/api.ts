import type {
  AgentRun,
  AgentRunSnapshot,
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
  DomainUsage,
  EnvFileModel,
  EnvName,
  HarnessGatewayConfig,
  HarnessGatewayState,
  HarnessLoadout,
  HarnessModelCatalog,
  HarnessStatus,
  InstancesState,
  StudioSettings,
  LayoutState,
  MergeResult,
  NodePosition,
  StaleReport,
  StudioCore,
  StudioSchemaBundle,
  ThreadEntry,
  ViewRuntime,
  ViewSessionResult,
  VisibilityState,
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
  createDomain: (name: string) =>
    post<{ ok: boolean; id?: string; origin?: string; error?: string; output: string }>(
      '/api/workspace/create',
      { name },
    ),
  catalog: () => get<DomainCatalogEntry[]>('/api/catalog'),
  instances: () => get<InstancesState>('/api/instances'),
  switchInstance: (name: string) =>
    post<{ ok: boolean; active: string | null; output: string }>('/api/instances/use', { name }),

  bundle: (id: string) => get<StudioSchemaBundle>(`${d(id)}/bundle`),
  core: (id: string) => get<StudioCore>(`${d(id)}/core`),
  anatomy: (id: string) => get<DomainAnatomy>(`${d(id)}/anatomy`),
  viewRuntime: (id: string, slug: string) =>
    get<ViewRuntime>(`${d(id)}/views/${encodeURIComponent(slug)}/runtime`),
  launchView: (id: string, slug: string, request: { targetId?: string }) =>
    post<ViewSessionResult>(`${d(id)}/views/${encodeURIComponent(slug)}/session`, request),
  closeViewSession: (id: string, sessionId: string) =>
    post<{ ok: true }>(`${d(id)}/views/sessions/close`, { sessionId }),
  updates: (id: string) => get<StaleReport>(`${d(id)}/updates`),
  applyUpdate: (id: string) => post<{ ok: boolean; error: string }>(`${d(id)}/updates/apply`, {}),

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
  editComment: (id: string, commentId: string, entryId: string, text: string) =>
    post<Comment>(`${d(id)}/comments`, { action: 'edit', id: commentId, entryId, text }),
  setCommentStatus: (
    id: string,
    commentId: string,
    status: 'open' | 'closed',
    closeNote?: string,
  ) => post<Comment>(`${d(id)}/comments`, { action: 'status', id: commentId, status, closeNote }),
  deleteComment: (id: string, commentId: string) =>
    post<{ ok: true }>(`${d(id)}/comments`, { action: 'delete', id: commentId }),
  mergeReply: (id: string, text: string) => post<MergeResult>(`${d(id)}/comments/merge`, { text }),

  settings: (id: string) => get<StudioSettings>(`${d(id)}/settings`),
  updateSettings: (id: string, settings: Partial<StudioSettings>) =>
    post<StudioSettings>(`${d(id)}/settings`, { action: 'update', settings }),

  // Every conversation call names its chat tab; omitting it means the active one.
  agentSnapshot: (id: string, chatId?: string) =>
    get<AgentRunSnapshot>(`${d(id)}/agent${chatQuery(chatId)}`),
  /** every terminal turn one chat kept, oldest first — its transcript */
  agentHistory: (id: string, chatId?: string) =>
    get<AgentRun[]>(`${d(id)}/agent/history${chatQuery(chatId)}`),
  agentSubmit: (id: string, message?: string, chatId?: string) =>
    post<AgentRun & { error?: string }>(`${d(id)}/agent/submit`, {
      ...(message ? { message } : {}),
      ...(chatId ? { chatId } : {}),
    }),
  // seamless continue after an interruption — resumes the live session with a bare nudge (no re-briefing)
  agentResume: (id: string, chatId?: string) =>
    post<AgentRun & { error?: string }>(`${d(id)}/agent/submit`, {
      resume: true,
      ...(chatId ? { chatId } : {}),
    }),
  agentCancel: (id: string, chatId?: string) =>
    post<{ ok: boolean }>(`${d(id)}/agent/cancel`, chatId ? { chatId } : {}),
  agentSession: (id: string, chatId?: string) =>
    get<AgentSessionInfo>(`${d(id)}/agent/session${chatQuery(chatId)}`),
  setAgentSession: (id: string, harness: string, sessionId: string, chatId?: string) =>
    post<AgentSessionInfo>(`${d(id)}/agent/session`, {
      harness,
      sessionId,
      ...(chatId ? { chatId } : {}),
    }),
  agentSystemPrompt: (id: string) => get<AgentSystemPromptInfo>(`${d(id)}/agent/prompt/system`),

  chats: (id: string) => get<ChatList>(`${d(id)}/agent/chats`),
  openChat: (id: string, harness?: string) =>
    post<ChatInfo>(`${d(id)}/agent/chats`, { action: 'open', ...(harness ? { harness } : {}) }),
  selectChat: (id: string, chatId: string) =>
    post<ChatList>(`${d(id)}/agent/chats`, { action: 'select', chatId }),
  closeChat: (id: string, chatId: string) =>
    post<ChatList>(`${d(id)}/agent/chats`, { action: 'close', chatId }),
  updateChat: (
    id: string,
    chatId: string,
    patch: { title?: string; model?: string; effort?: string },
  ) => post<ChatInfo>(`${d(id)}/agent/chats`, { action: 'update', chatId, ...patch }),
  /** fork this chat onto the other agent, carrying a summary of it */
  switchChatHarness: (id: string, chatId: string, harness: string, model?: string) =>
    post<ChatInfo>(`${d(id)}/agent/chats`, {
      action: 'switch-harness',
      chatId,
      harness,
      ...(model ? { model } : {}),
    }),
  /** drop an unsent fork summary — delivered conversation context is immutable */
  forgetChatOrigin: (id: string, chatId: string) =>
    post<ChatInfo>(`${d(id)}/agent/chats`, { action: 'forget-origin', chatId }),

  harness: (id: string) => get<HarnessStatus>(`${d(id)}/agent/harness`),
  /** every harness's selectable models — what the composer's picker offers */
  models: (id: string) => get<HarnessModelCatalog[]>(`${d(id)}/agent/models`),
  harnessGateway: (id: string) => get<HarnessGatewayState>(`${d(id)}/agent/harness-gateway`),
  setHarnessGateway: (id: string, scope: 'domain' | 'global', config: HarnessGatewayConfig) =>
    post<HarnessGatewayState>(`${d(id)}/agent/harness-gateway`, { action: 'set', scope, config }),
  clearHarnessGateway: (id: string, scope: 'domain' | 'global') =>
    post<HarnessGatewayState>(`${d(id)}/agent/harness-gateway`, { action: 'clear', scope }),
  // EMBED seam: relay a host-supplied delegation token to the server for `host`
  // auth mode. Called by the Astrale GUI glue when the studio runs as an iframe.
  pushHostToken: (id: string, token: string) =>
    post<{ ok: boolean }>(`${d(id)}/agent/harness-gateway/host-token`, { token }),
  loadout: (id: string, refresh = false, chatId?: string) =>
    get<HarnessLoadout>(
      `${d(id)}/agent/loadout?${new URLSearchParams({
        ...(refresh ? { refresh: '1' } : {}),
        ...(chatId ? { chat: chatId } : {}),
      })}`,
    ),
  usage: (id: string) => get<DomainUsage>(`${d(id)}/agent/usage`),

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

  visibility: (id: string) => get<VisibilityState>(`${d(id)}/visibility`),
  setVisibility: (id: string, state: VisibilityState) =>
    post<VisibilityState>(`${d(id)}/visibility`, { action: 'set', ...state }),
}

export const qk = {
  workspace: ['workspace'] as const,
  catalog: ['catalog'] as const,
  instances: ['instances'] as const,
  bundle: (id: string) => ['bundle', id] as const,
  core: (id: string) => ['core', id] as const,
  anatomy: (id: string) => ['anatomy', id] as const,
  viewRuntime: (id: string, slug: string) => ['view-runtime', id, slug] as const,
  updates: (id: string) => ['updates', id] as const,
  comments: (id: string) => ['comments', id] as const,
  settings: (id: string) => ['settings', id] as const,
  layout: (id: string) => ['layout', id] as const,
  visibility: (id: string) => ['visibility', id] as const,
  documents: (id: string) => ['documents', id] as const,
  // Chat-scoped keys nest under the domain, so invalidating `['agent', id]`
  // still refreshes every open tab of that domain.
  agent: (id: string, chatId?: string) =>
    chatId ? (['agent', id, chatId] as const) : (['agent', id] as const),
  agentHistory: (id: string, chatId?: string) =>
    chatId ? (['agent-history', id, chatId] as const) : (['agent-history', id] as const),
  agentSession: (id: string, chatId?: string) =>
    chatId ? (['agent-session', id, chatId] as const) : (['agent-session', id] as const),
  agentSystemPrompt: (id: string) => ['agent-system-prompt', id] as const,
  chats: (id: string) => ['chats', id] as const,
  models: (id: string) => ['agent-models', id] as const,
  harness: (id: string) => ['harness', id] as const,
  harnessGateway: (id: string) => ['harness-gateway', id] as const,
  loadout: (id: string, chatId?: string) =>
    chatId ? (['loadout', id, chatId] as const) : (['loadout', id] as const),
  usage: (id: string) => ['usage', id] as const,
  env: (id: string, env: string) => ['env', id, env] as const,
}
