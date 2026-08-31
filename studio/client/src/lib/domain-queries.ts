import { queryOptions } from '@tanstack/react-query'

import { api, qk } from './api'

export const bundleQueryOptions = (domainId: string) =>
  queryOptions({
    queryKey: qk.bundle(domainId),
    queryFn: () => api.bundle(domainId),
  })

export const anatomyQueryOptions = (domainId: string) =>
  queryOptions({
    queryKey: qk.anatomy(domainId),
    queryFn: () => api.anatomy(domainId),
  })

/** Layout and visibility are client-authoritative while an edit is in flight. */
export const layoutQueryOptions = (domainId: string) =>
  queryOptions({
    queryKey: qk.layout(domainId),
    queryFn: () => api.layout(domainId),
    staleTime: Number.POSITIVE_INFINITY,
  })

export const visibilityQueryOptions = (domainId: string) =>
  queryOptions({
    queryKey: qk.visibility(domainId),
    queryFn: () => api.visibility(domainId),
    staleTime: Number.POSITIVE_INFINITY,
  })
