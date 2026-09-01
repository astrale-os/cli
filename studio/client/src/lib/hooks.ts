import type { EnvName } from '@shared/types'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { api, qk } from './api'
import { anatomyQueryOptions, bundleQueryOptions } from './domain-queries'
import { type ViewsModel, buildViewsModel } from './views'

export function useWorkspace() {
  return useQuery({ queryKey: qk.workspace, queryFn: api.workspace })
}
export function useCatalog() {
  return useQuery({ queryKey: qk.catalog, queryFn: api.catalog })
}
export function useInstances() {
  return useQuery({ queryKey: qk.instances, queryFn: api.instances, refetchInterval: 30000 })
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
  return useQuery({
    queryKey: qk.updates(id ?? ''),
    queryFn: () => api.updates(id!),
    enabled: !!id,
    staleTime: 5 * 60_000,
    refetchInterval: settings?.updatesPollMs ?? 10 * 60_000,
  })
}

export function useAgentSession(id?: string, chatId?: string) {
  return useQuery({
    queryKey: qk.agentSession(id ?? '', chatId),
    queryFn: () => api.agentSession(id!, chatId),
    enabled: !!id,
  })
}
export function useAgentSystemPrompt(id?: string) {
  return useQuery({
    queryKey: qk.agentSystemPrompt(id ?? ''),
    queryFn: () => api.agentSystemPrompt(id!),
    enabled: !!id,
    staleTime: 300_000,
  })
}

export function useHarness(id?: string) {
  return useQuery({
    queryKey: qk.harness(id ?? ''),
    queryFn: () => api.harness(id!),
    enabled: !!id,
    staleTime: 15_000,
  })
}
export function useHarnessGateway(id?: string) {
  return useQuery({
    queryKey: qk.harnessGateway(id ?? ''),
    queryFn: () => api.harnessGateway(id!),
    enabled: !!id,
  })
}
export function useLoadout(id?: string, chatId?: string) {
  // Probes the chat's own local harness — keep it lazy and cached for a while.
  return useQuery({
    queryKey: qk.loadout(id ?? '', chatId),
    queryFn: () => api.loadout(id!, false, chatId),
    enabled: !!id,
    staleTime: 60_000,
  })
}
export function useUsage(id?: string) {
  return useQuery({ queryKey: qk.usage(id ?? ''), queryFn: () => api.usage(id!), enabled: !!id })
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
export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.settings })
}
export function useCore(id?: string) {
  return useQuery({ queryKey: qk.core(id ?? ''), queryFn: () => api.core(id!), enabled: !!id })
}
export function useDocuments(id?: string) {
  return useQuery({
    queryKey: qk.documents(id ?? ''),
    queryFn: () => api.documents(id!),
    enabled: !!id,
  })
}

/** Invalidate every query for a domain (used by the SSE bridge). Memoized so its
 *  identity is stable — otherwise it churns the SSE onEvent callback, which would
 *  tear down and reopen the EventSource on every render and drop live frames. */
export function useInvalidateDomain() {
  const qc = useQueryClient()
  return useCallback(
    (id: string) => {
      for (const key of ['bundle', 'anatomy', 'comments', 'core', 'env']) {
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
