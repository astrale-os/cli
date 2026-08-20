import type { HandlerLink, IrCallableAuth, IrFunction, IrMethod } from '@shared/types'

/** A callable's authorization verdict, derived from canonical IR first.
 *  Legacy auth:'required'(default)|'optional'|'public' = authentication; `authorize`
 *  = the authz gate. A non-public legacy method with no real authorize warns. */
import { Globe, ShieldAlert, ShieldCheck, ShieldX, type LucideIcon } from 'lucide-react'

export type AuthLevel = 'secured' | 'public' | 'open' | 'insecure'

/** IconTile tone tokens (see studio-kit TONES). */
type Tone = 'emerald' | 'sky' | 'amber' | 'rose'
/** Chip tone tokens (see studio-kit CHIP). */
type ChipTone = 'success' | 'primary' | 'warning' | 'danger'

export interface AuthVerdict {
  level: AuthLevel
  /** counts toward the per-class "N unguarded" roll-up. */
  warn: boolean
  icon: LucideIcon
  tone: Tone
  chipTone: ChipTone
  /** short headline, e.g. "Unguarded". */
  label: string
  /** one-sentence explanation for the hover card. */
  blurb: string
  auth: 'public' | 'optional' | 'required' | IrCallableAuth
  authorize: 'absent' | 'noop' | 'custom'
}

/** The canonical callable surface shared by Methods and standalone Functions. */
export type AuthCallable = Pick<IrMethod, 'auth'> | Pick<IrFunction, 'auth'>

/** One callable and its optional implementation overlay, used by aggregate helpers. */
export interface MethodAuthSubject {
  method?: AuthCallable
  link?: HandlerLink
}

/** Resolve handler wiring without conflating a same-named Class and Interface.
 * Persisted pre-ownerKind overlays remain a last-resort legacy fallback. */
export function handlerLinkFor(
  links: readonly HandlerLink[],
  owner: string,
  method: string,
  ownerKind: HandlerLink['ownerKind'],
): HandlerLink | undefined {
  const candidates = links.filter((link) => link.owner === owner && link.method === method)
  return (
    candidates.find((link) => link.ownerKind === ownerKind) ??
    candidates.find((link) => !('ownerKind' in link) || link.ownerKind === undefined)
  )
}

function canonicalVerdict(auth: IrCallableAuth): AuthVerdict {
  if (auth === 'anonymous') {
    return {
      level: 'public',
      warn: false,
      icon: Globe,
      tone: 'sky',
      chipTone: 'primary',
      label: 'Anonymous',
      auth,
      authorize: 'absent',
      blurb: 'The canonical callable contract permits anonymous callers.',
    }
  }
  if (auth === 'authenticated') {
    return {
      level: 'secured',
      warn: false,
      icon: ShieldCheck,
      tone: 'emerald',
      chipTone: 'success',
      label: 'Authenticated',
      auth,
      authorize: 'absent',
      blurb: 'The canonical callable contract requires an authenticated principal.',
    }
  }
  return {
    level: 'secured',
    warn: false,
    icon: ShieldCheck,
    tone: 'emerald',
    chipTone: 'success',
    label: 'Authorized',
    auth,
    authorize: 'custom',
    blurb: 'The canonical callable contract requires authorization.',
  }
}

function isCallableAuth(value: unknown): value is IrCallableAuth {
  return value === 'anonymous' || value === 'authenticated' || value === 'authorized'
}

function isHandlerLink(value: unknown): value is HandlerLink {
  return (
    !!value && typeof value === 'object' && 'method' in value && typeof value.method === 'string'
  )
}

/**
 * The authorization verdict for a callable. Canonical schema auth is
 * authoritative, including when no HandlerLink exists. HandlerLink facts are
 * retained only for legacy schemas and overlays that do not expose auth in IR.
 */
export function methodAuth(link?: HandlerLink): AuthVerdict | null
export function methodAuth(method: AuthCallable | undefined, link?: HandlerLink): AuthVerdict | null
export function methodAuth(
  methodOrLink?: AuthCallable | HandlerLink,
  linkedHandler?: HandlerLink,
): AuthVerdict | null {
  const legacyCall = isHandlerLink(methodOrLink)
  const method = legacyCall ? undefined : methodOrLink
  const link = legacyCall ? methodOrLink : linkedHandler
  const canonicalAuth = method?.auth ?? link?.callableAuth
  if (isCallableAuth(canonicalAuth)) return canonicalVerdict(canonicalAuth)
  if (!link) return null

  const auth = link.auth ?? 'required'
  const authorize = link.authorize ?? 'absent'
  // 'custom' = the authorize hook actually does something (not an allow-all noop).
  const custom = authorize === 'custom'

  if (auth === 'public') {
    return {
      level: 'public',
      warn: false,
      icon: Globe,
      tone: 'sky',
      chipTone: 'primary',
      label: 'Public',
      auth,
      authorize,
      blurb: 'Public — no credential required.',
    }
  }

  if (custom) {
    return {
      level: 'secured',
      warn: false,
      icon: ShieldCheck,
      tone: 'emerald',
      chipTone: 'success',
      label: 'Secured',
      auth,
      authorize,
      blurb: 'Runs an authorization check.',
    }
  }

  if (auth === 'optional') {
    return {
      level: 'open',
      warn: true,
      icon: ShieldX,
      tone: 'rose',
      chipTone: 'danger',
      label: 'Open',
      auth,
      authorize,
      blurb: 'No authz check — even anonymous callers pass.',
    }
  }
  return {
    level: 'insecure',
    warn: true,
    icon: ShieldAlert,
    tone: 'amber',
    chipTone: 'warning',
    label: 'Unguarded',
    auth,
    authorize,
    blurb: 'No authz check — any authenticated caller passes.',
  }
}

/** Per-class roll-up: how many of these methods warrant review. */
export function unguardedCount(
  subjects: readonly (MethodAuthSubject | HandlerLink | undefined)[],
): number {
  let n = 0
  for (const subject of subjects) {
    const verdict = isHandlerLink(subject)
      ? methodAuth(subject)
      : methodAuth(subject?.method, subject?.link)
    if (verdict?.warn) n++
  }
  return n
}
