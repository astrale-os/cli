import type { EnvName } from '@shared/types'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { api, qk } from './api'
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
  return useQuery({ queryKey: qk.bundle(id ?? ''), queryFn: () => api.bundle(id!), enabled: !!id })
}
export function useAnatomy(id?: string) {
  return useQuery({
    queryKey: qk.anatomy(id ?? ''),
    queryFn: () => api.anatomy(id!),
    enabled: !!id,
  })
}
/** Lazily resolve a view's live URL (only when `enabled`, e.g. its modal is open). */
export function useViewUrl(id?: string, slug?: string, enabled = true) {
  return useQuery({
    queryKey: qk.viewUrl(id ?? '', slug ?? ''),
    queryFn: () => api.viewUrl(id!, slug!),
    enabled: enabled && !!id && !!slug,
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
  const { data: settings } = useSettings(id)
  return useQuery({
    queryKey: qk.updates(id ?? ''),
    queryFn: () => api.updates(id!),
    enabled: !!id,
    staleTime: 5 * 60_000,
    refetchInterval: settings?.updatesPollMs ?? 10 * 60_000,
  })
}

export function useAgentSession(id?: string) {
  return useQuery({
    queryKey: qk.agentSession(id ?? ''),
    queryFn: () => api.agentSession(id!),
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
export function useLoadout(id?: string) {
  // the probe spawns `claude` — keep it lazy (enabled by the caller) and cached a while
  return useQuery({
    queryKey: qk.loadout(id ?? ''),
    queryFn: () => api.loadout(id!),
    enabled: !!id,
    staleTime: 60_000,
  })
}
export function useUsage(id?: string) {
  return useQuery({ queryKey: qk.usage(id ?? ''), queryFn: () => api.usage(id!), enabled: !!id })
}
export function useSkillContent(id?: string, command?: string) {
  return useQuery({
    queryKey: qk.skillContent(id ?? '', command ?? ''),
    queryFn: () => api.skillContent(id!, command!),
    enabled: !!id && !!command,
    staleTime: 300_000,
  })
}
export function useEnv(id?: string, env: EnvName = 'dev', enabled = true) {
  // refetches on any domain SSE (env.ts edits invalidate 'env') — see useInvalidateDomain
  return useQuery({
    queryKey: qk.env(id ?? '', env),
    queryFn: () => api.env(id!, env),
    enabled: enabled && !!id,
  })
}
export function useInstance(id?: string) {
  const { data: settings } = useSettings(id)
  return useQuery({
    queryKey: qk.instance(id ?? ''),
    queryFn: () => api.instance(id!),
    enabled: !!id,
    refetchInterval: settings?.instancePollMs ?? 30000,
  })
}
export function useComments(id?: string) {
  return useQuery({
    queryKey: qk.comments(id ?? ''),
    queryFn: () => api.comments(id!),
    enabled: !!id,
  })
}
export function useContext(id?: string) {
  return useQuery({
    queryKey: qk.context(id ?? ''),
    queryFn: () => api.context(id!),
    enabled: !!id,
  })
}
export function useIntegrations(id?: string) {
  return useQuery({
    queryKey: qk.integrations(id ?? ''),
    queryFn: () => api.integrations(id!),
    enabled: !!id,
  })
}
export function useSettings(id?: string) {
  return useQuery({
    queryKey: qk.settings(id ?? ''),
    queryFn: () => api.settings(id!),
    enabled: !!id,
  })
}
export function useCore(id?: string) {
  return useQuery({ queryKey: qk.core(id ?? ''), queryFn: () => api.core(id!), enabled: !!id })
}
export function useLayout(id?: string) {
  // client-authoritative: every layout write keeps this cache in sync via setQueryData,
  // so it must NOT be refetched out from under us (a stale refetch would clobber a fresh
  // drag while its debounced disk write is still in flight — e.g. on a core⇄schema remount).
  return useQuery({
    queryKey: qk.layout(id ?? ''),
    queryFn: () => api.layout(id!),
    enabled: !!id,
    staleTime: Number.POSITIVE_INFINITY,
  })
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
      for (const key of [
        'bundle',
        'anatomy',
        'comments',
        'context',
        'integrations',
        'core',
        'env',
      ]) {
        qc.invalidateQueries({ queryKey: [key, id] })
      }
    },
    [qc],
  )
}

export function useCommentMutations(id: string) {
  const qc = useQueryClient()
  const inval = () => qc.invalidateQueries({ queryKey: qk.comments(id) })
  return {
    create: useMutation({
      mutationFn: (b: Parameters<typeof api.createComment>[1]) => api.createComment(id, b),
      onSuccess: inval,
    }),
    reply: useMutation({
      mutationFn: (v: { commentId: string; entry: Parameters<typeof api.replyComment>[2] }) =>
        api.replyComment(id, v.commentId, v.entry),
      onSuccess: inval,
    }),
    edit: useMutation({
      mutationFn: (v: { commentId: string; entryId: string; text: string }) =>
        api.editComment(id, v.commentId, v.entryId, v.text),
      onSuccess: inval,
    }),
    setStatus: useMutation({
      mutationFn: (v: { commentId: string; status: 'open' | 'closed'; closeNote?: string }) =>
        api.setCommentStatus(id, v.commentId, v.status, v.closeNote),
      onSuccess: inval,
    }),
    remove: useMutation({
      mutationFn: (commentId: string) => api.deleteComment(id, commentId),
      onSuccess: inval,
    }),
    merge: useMutation({
      mutationFn: (text: string) => api.mergeReply(id, text),
      onSuccess: inval,
    }),
  }
}
