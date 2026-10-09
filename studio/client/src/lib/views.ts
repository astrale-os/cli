/**
 * views.ts - cross-reference the declared views (from anatomy) against the schema
 * (bundle.ir.views) and the client implementation (anatomy.client.routes) to produce
 * the studio's view model: each view and its drift status. Every View belongs to its
 * Domain; none is bound to a Class. Pure derivation over server-provided ground truths.
 */
import type { DomainAnatomy, StudioSchemaBundle, ViewInfo } from '@shared/types'

export type ViewDrift = 'ok' | 'missing-impl' // SPA view declares a mount that the client `ROUTES` doesn't implement

export interface ViewModel extends ViewInfo {
  drift: ViewDrift
}

export interface ViewsModel {
  all: ViewModel[]
  /** client routes with no declaring view (a dangling SPA route) */
  orphanRoutes: string[]
  hasDrift: boolean
}

export function buildViewsModel(anatomy?: DomainAnatomy, bundle?: StudioSchemaBundle): ViewsModel {
  const ir = bundle?.ir
  const views = anatomy?.views ?? []
  const routes = anatomy?.client.routes ?? {}

  const all: ViewModel[] = views.map((v) => {
    // Current frontends declare their route as a verified SDK artifact rather
    // than a client-local route registry. The canonical View declaration
    // plus the statically discovered artifact route is already the contract.
    const drift: ViewDrift =
      v.kind === 'spa' && v.mount && !(v.mount in routes) && !ir?.views?.[v.slug]
        ? 'missing-impl'
        : 'ok'
    return { ...v, drift }
  })

  const mounts = new Set(all.map((v) => v.mount).filter((m): m is string => !!m))
  const orphanRoutes = Object.keys(routes).filter((r) => !mounts.has(r))
  const hasDrift = all.some((v) => v.drift === 'missing-impl') || orphanRoutes.length > 0

  return { all, orphanRoutes, hasDrift }
}

/** Human label + tone for a drift status (tone maps to a Tailwind text color). */
export function driftLabel(d: ViewDrift): { text: string; tone: 'warn' | 'muted' } | null {
  switch (d) {
    case 'missing-impl':
      return { text: 'no client route', tone: 'warn' }
    default:
      return null
  }
}
