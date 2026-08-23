/**
 * views.ts — cross-reference the declared views (from anatomy) against the schema
 * (bundle.ir.classes) and the client implementation (anatomy.client.routes) to
 * produce the studio's view model: each view's bound class, whether it's unbound,
 * and its drift status. Pure derivation over server-provided ground truths.
 */
import type {
  DomainAnatomy,
  IrClassRef,
  SchemaIR,
  StudioSchemaBundle,
  ViewInfo,
} from '@shared/types'

import { classRefKey, isIrClassRef } from '@shared/schema/identity'

export type ViewDrift =
  | 'ok'
  | 'missing-impl' // SPA view declares a mount that the client `ROUTES` doesn't implement
  | 'unbound-class' // viewFor names a class that doesn't exist in the schema
  | 'schema-unavailable' // deps not installed ⇒ no IR ⇒ binding can't be checked (informational, not an error)

export interface ViewModel extends ViewInfo {
  /** the classes this view binds to that resolve against the schema */
  boundClasses: string[]
  /** the primary bound class (boundClasses[0]) for display, or null */
  boundClass: string | null
  /** not attached to a real class in this domain (no viewFor, or none resolved) */
  unbound: boolean
  drift: ViewDrift
}

export interface ViewsModel {
  all: ViewModel[]
  /** boundClass → its views */
  byClass: Map<string, ViewModel[]>
  /** views not bound to a real class (global, or viewFor unresolved) */
  unbound: ViewModel[]
  /** client routes with no declaring view (a dangling SPA route) */
  orphanRoutes: string[]
  hasDrift: boolean
}

function exactClassExists(ir: SchemaIR, ref: IrClassRef): boolean {
  return ref.origin === ir.domain ? !!ir.classes[ref.name] : !!ir.importsByKey[classRefKey(ref)]
}

export function buildViewsModel(anatomy?: DomainAnatomy, bundle?: StudioSchemaBundle): ViewsModel {
  const views = anatomy?.views ?? []
  const routes = anatomy?.client.routes ?? {}
  const classNames = new Set(Object.keys(bundle?.ir?.classes ?? {}))
  // The schema is only trustworthy when deps are installed (else ir is null and EVERY
  // viewFor would look "unknown"). Without it we can't confirm bindings — say so, don't cry drift.
  const schemaKnown = !!bundle?.depsInstalled && !!bundle?.ir

  const all: ViewModel[] = views.map((v) => {
    const canonicalTarget = bundle?.ir?.views?.[v.slug]?.target
    const canonicalDefinitions = canonicalTarget
      ? canonicalTarget.kind === 'definition'
        ? canonicalTarget.definitions.filter(isIrClassRef)
        : []
      : undefined
    const declared = canonicalDefinitions
      ? canonicalDefinitions.map((definition) => definition.name)
      : Array.isArray(v.viewFor)
        ? v.viewFor
        : v.viewFor
          ? [v.viewFor]
          : []
    const exactResolved = canonicalDefinitions?.filter((definition) =>
      bundle?.ir ? exactClassExists(bundle.ir, definition) : false,
    )
    const sourceResolved = canonicalDefinitions
      ? undefined
      : declared.filter((name) => classNames.has(name))
    // Existing panels and detail routes use member labels. Keep those stable
    // while resolution itself remains keyed by the exact canonical coordinate.
    const boundClasses = [
      ...new Set(
        exactResolved
          ? exactResolved
              .filter((definition) => definition.origin === bundle?.ir?.domain)
              .map((definition) => definition.name)
          : (sourceResolved ?? []),
      ),
    ]
    const resolvedCount = exactResolved?.length ?? sourceResolved?.length ?? 0
    const boundClass = boundClasses[0] ?? null
    let drift: ViewDrift = 'ok'
    if (declared.length && resolvedCount < declared.length) {
      // a declared class didn't resolve — a real mistake only if we can trust the schema
      drift = schemaKnown ? 'unbound-class' : 'schema-unavailable'
    } else if (
      v.kind === 'spa' &&
      v.mount &&
      !(v.mount in routes) &&
      !bundle?.ir?.views?.[v.slug]
    ) {
      // Current frontends declare their route as a verified SDK artifact rather
      // than a client-local route registry. The canonical View declaration
      // plus the statically discovered artifact route is already the contract.
      drift = 'missing-impl'
    }
    // unbound = declared no class at all (global), OR none of its declared classes resolved
    const unbound = declared.length === 0 || boundClasses.length === 0
    return { ...v, boundClasses, boundClass, unbound, drift }
  })

  const byClass = new Map<string, ViewModel[]>()
  for (const v of all) {
    for (const cls of v.boundClasses) {
      const arr = byClass.get(cls) ?? []
      arr.push(v)
      byClass.set(cls, arr)
    }
  }

  const unbound = all.filter((v) => v.unbound)
  const mounts = new Set(all.map((v) => v.mount).filter((m): m is string => !!m))
  const orphanRoutes = Object.keys(routes).filter((r) => !mounts.has(r))
  // schema-unavailable is informational, not actionable drift
  const hasDrift =
    all.some((v) => v.drift === 'missing-impl' || v.drift === 'unbound-class') ||
    orphanRoutes.length > 0

  return { all, byClass, unbound, orphanRoutes, hasDrift }
}

export function viewsForClass(model: ViewsModel, className: string): ViewModel[] {
  return model.byClass.get(className) ?? []
}

/** Human label + tone for a drift status (tone maps to a Tailwind text color). */
export function driftLabel(d: ViewDrift): { text: string; tone: 'warn' | 'muted' } | null {
  switch (d) {
    case 'missing-impl':
      return { text: 'no client route', tone: 'warn' }
    case 'unbound-class':
      return { text: 'unknown class', tone: 'warn' }
    case 'schema-unavailable':
      return { text: 'deps not installed', tone: 'muted' }
    default:
      return null
  }
}
