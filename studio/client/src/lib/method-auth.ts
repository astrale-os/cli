import type { HandlerLink } from '@shared/types'

/** A method's authorization verdict, derived from its HandlerLink facts.
 *  auth:'required'(default)|'optional'|'public' = authentication; `authorize` = the
 *  authz gate. A non-public method with no real authorize (absent/noop) warns. */
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
  auth: 'public' | 'optional' | 'required'
  authorize: 'absent' | 'noop' | 'custom'
}

/**
 * The authorization verdict for a wired method, or `null` when there is no
 * handler wiring to assess (abstract/contract interface methods).
 */
export function methodAuth(link?: HandlerLink): AuthVerdict | null {
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
export function unguardedCount(links: (HandlerLink | undefined)[]): number {
  let n = 0
  for (const link of links) if (methodAuth(link)?.warn) n++
  return n
}
