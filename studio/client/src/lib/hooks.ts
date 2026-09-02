import type { CommentStore, DocMeta, DomainSummary, EnvName } from '@shared/types'

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from './api'
import { anatomyQueryOptions, bundleQueryOptions } from './domain-queries'
import { useUI } from './store'
import { type ViewsModel, buildViewsModel } from './views'

/** However slow the schema is, nothing waits on it longer than this. */
const DEFER_CEILING_MS = 5_000

/**
 * Has the canvas got its schema yet — or is there no domain to wait for?
 *
 * A browser opens six connections to one origin, and several studio reads shell out
 * to the CLI: a process start each, seconds apiece. Fired alongside the canvas
 * queries they took the slots the canvas was waiting on, so the schema landed AFTER
 * the update badge and the harness probe. They wait their turn now — but only for a
 * few seconds: the instance switcher and the agent are not the canvas's dependants,
 * and a domain being indexed for the first time can keep it waiting a while.
 *
 * Exported for the model catalog, which lives in `chats.ts` and is the heaviest of
 * these reads — one ACP session per installed agent.
 */
export function useSchemaSettled(): boolean {
  const selectedDomainId = useUI((state) => state.selectionDomainId)
  const workspace = useQuery({ queryKey: qk.workspace, queryFn: api.workspace })
  const domainId = selectedDomainId ?? workspace.data?.[0]?.id
  const bundle = useQuery({ ...bundleQueryOptions(domainId ?? ''), enabled: !!domainId })
  const anatomy = useQuery({ ...anatomyQueryOptions(domainId ?? ''), enabled: !!domainId })
  const [expiredDomainId, setExpiredDomainId] = useState<string>()
  useEffect(() => {
    if (!domainId) return undefined
    const timer = setTimeout(() => setExpiredDomainId(domainId), DEFER_CEILING_MS)
    return () => clearTimeout(timer)
  }, [domainId])
  const settled = (q: { data?: unknown; isError: boolean }) => q.data !== undefined || q.isError
  return !domainId || expiredDomainId === domainId || (settled(bundle) && settled(anatomy))
}

export function useWorkspace() {
  return useQuery({ queryKey: qk.workspace, queryFn: api.workspace })
}
export function useCatalog() {
  return useQuery({ queryKey: qk.catalog, queryFn: api.catalog })
}
export function useInstances() {
  const settled = useSchemaSettled()
  const { data: settings } = useSettings()
  return useQuery({
    queryKey: qk.instances,
    queryFn: api.instances,
    enabled: settled,
    staleTime: 30_000,
    refetchInterval: settings?.instancePollMs ?? 30_000,
  })
}
export function useBundle(id?: string) {
  return useQuery({ ...bundleQueryOptions(id ?? ''), enabled: !!id })
}
export function useAnatomy(id?: string) {
  return useQuery({ ...anatomyQueryOptions(id ?? ''), enabled: !!id })
}
/** Lazily start the domain frontend and resolve target candidates for one view. */
export function useViewRuntime(id?: string, slug?: string, enabled = true) {
  return useQuery({
    queryKey: qk.viewRuntime(id ?? '', slug ?? ''),
    queryFn: () => api.viewRuntime(id!, slug!),
    enabled: enabled && !!id && !!slug,
    staleTime: 2000,
    refetchInterval: enabled ? 10_000 : false,
  })
}
/** Declared views cross-referenced with the schema + client routes (binding + drift). */
export function useViewsModel(id?: string): ViewsModel {
  const { data: anatomy } = useAnatomy(id)
  const { data: bundle } = useBundle(id)
  return useMemo(() => buildViewsModel(anatomy, bundle), [anatomy, bundle])
}
/** Staleness for the header Update badge — checked on load, then occasionally
 *  (the check shells out to the CLI + registry, so keep the cadence relaxed). */
export function useUpdates(id?: string) {
  const { data: settings } = useSettings()
  const settled = useSchemaSettled()
  return useQuery({
    queryKey: qk.updates(id ?? ''),
    queryFn: () => api.updates(id!),
    enabled: !!id && settled,
    staleTime: 5 * 60_000,
    refetchInterval: settings?.updatesPollMs ?? 10 * 60_000,
  })
}

export function useAgentSession(chatId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.agentSession(chatId),
    queryFn: () => api.agentSession(chatId),
    enabled,
  })
}
export function useAgentSystemPrompt(enabled = true) {
  return useQuery({
    queryKey: qk.agentSystemPrompt,
    queryFn: api.agentSystemPrompt,
    enabled,
    staleTime: 300_000,
  })
}

export function useHarness(enabled = true) {
  return useQuery({
    queryKey: qk.harness,
    queryFn: api.harness,
    enabled,
    staleTime: 15_000,
  })
}
export function useHarnessGateway(enabled = true) {
  return useQuery({
    queryKey: qk.harnessGateway,
    queryFn: api.harnessGateway,
    enabled,
  })
}
export function useLoadout(chatId?: string, enabled = true) {
  // Probes the chat's own local harness — behind the canvas, and cached for a
  // while. `enabled` is for the caller that must not probe before it knows WHICH
  // chat: the key carries the chat id, so a render that has not learned it yet
  // would spend a whole ACP session on a query nothing reads again.
  const settled = useSchemaSettled()
  return useQuery({
    queryKey: qk.loadout(chatId),
    queryFn: () => api.loadout(false, chatId),
    enabled: enabled && settled,
    staleTime: 60_000,
  })
}
export function useUsage(enabled = true) {
  return useQuery({ queryKey: qk.usage, queryFn: api.usage, enabled })
}
export function useEnv(id?: string, env: EnvName = 'dev', enabled = true) {
  // refetches on any domain SSE (env.ts edits invalidate 'env') — see useInvalidateDomain
  return useQuery({
    queryKey: qk.env(id ?? '', env),
    queryFn: () => api.env(id!, env),
    enabled: enabled && !!id,
  })
}
export function useComments(id?: string) {
  return useQuery({
    queryKey: qk.comments(id ?? ''),
    queryFn: () => api.comments(id!),
    enabled: !!id,
  })
}

export interface WorkspaceDomainComments {
  domain: DomainSummary
  store?: CommentStore
}

/** Every domain's comments, retaining the owner needed for mutations and navigation. */
export function useWorkspaceComments(): {
  data: WorkspaceDomainComments[]
  isLoading: boolean
} {
  const workspace = useWorkspace()
  const domains = workspace.data ?? []
  const results = useQueries({
    queries: domains.map((domain) => ({
      queryKey: qk.comments(domain.id),
      queryFn: () => api.comments(domain.id),
    })),
  })
  return {
    data: domains.map((domain, index) => ({ domain, store: results[index]?.data })),
    isLoading: workspace.isLoading || results.some((result) => result.isLoading),
  }
}
export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.settings })
}
export function useCore(id?: string) {
  return useQuery({ queryKey: qk.core(id ?? ''), queryFn: () => api.core(id!), enabled: !!id })
}
export function useDatasets(id?: string) {
  return useQuery({
    queryKey: qk.datasets(id ?? ''),
    queryFn: () => api.datasets(id!),
    enabled: !!id,
  })
}
export function useDocuments(id?: string) {
  return useQuery({
    queryKey: qk.documents(id ?? ''),
    queryFn: () => api.documents(id!),
    enabled: !!id,
  })
}

export interface WorkspaceDomainDocuments {
  domain: DomainSummary
  documents?: DocMeta[]
}

/** Every domain's attached context, retaining where each document is stored. */
export function useWorkspaceDocuments(): {
  data: WorkspaceDomainDocuments[]
  isLoading: boolean
} {
  const workspace = useWorkspace()
  const domains = workspace.data ?? []
  const results = useQueries({
    queries: domains.map((domain) => ({
      queryKey: qk.documents(domain.id),
      queryFn: () => api.documents(domain.id),
    })),
  })
  return {
    data: domains.map((domain, index) => ({ domain, documents: results[index]?.data })),
    isLoading: workspace.isLoading || results.some((result) => result.isLoading),
  }
}

/** Invalidate every query for a domain (used by the SSE bridge). Memoized so its
 *  identity is stable — otherwise it churns the SSE onEvent callback, which would
 *  tear down and reopen the EventSource on every render and drop live frames. */
export function useInvalidateDomain() {
  const qc = useQueryClient()
  return useCallback(
    (id: string) => {
      for (const key of ['bundle', 'anatomy', 'comments', 'core', 'datasets', 'env']) {
        qc.invalidateQueries({ queryKey: [key, id] })
      }
    },
    [qc],
  )
}

export function useCommentMutations(id: string) {
  const qc = useQueryClient()
  const inval = () => qc.invalidateQueries({ queryKey: qk.comments(id) })
  // A dropped write must never look like it worked: every comment mutation
  // surfaces its failure, so the UI never silently discards what was typed.
  const onError = (error: unknown) => toast.error(String((error as Error)?.message ?? error))
  return {
    create: useMutation({
      onError,
      mutationFn: (b: Parameters<typeof api.createComment>[1]) => api.createComment(id, b),
      onSuccess: inval,
    }),
    reply: useMutation({
      onError,
      mutationFn: (v: { commentId: string; entry: Parameters<typeof api.replyComment>[2] }) =>
        api.replyComment(id, v.commentId, v.entry),
      onSuccess: inval,
    }),
    edit: useMutation({
      onError,
      mutationFn: (v: { commentId: string; entryId: string; text: string }) =>
        api.editComment(id, v.commentId, v.entryId, v.text),
      onSuccess: inval,
    }),
    setStatus: useMutation({
      onError,
      mutationFn: (v: { commentId: string; status: 'open' | 'closed'; closeNote?: string }) =>
        api.setCommentStatus(id, v.commentId, v.status, v.closeNote),
      onSuccess: inval,
    }),
    remove: useMutation({
      onError,
      mutationFn: (commentId: string) => api.deleteComment(id, commentId),
      onSuccess: inval,
    }),
    merge: useMutation({
      onError,
      mutationFn: (text: string) => api.mergeReply(id, text),
      onSuccess: inval,
    }),
  }
}
