import type { HandlerLink, IrCallableAuth, IrFunction, IrMethod } from '@shared/types'

import { Globe, Puzzle, ShieldCheck, UserRound, Zap, type LucideIcon } from 'lucide-react'

interface AuthVerdict {
  level: 'secured' | 'authenticated' | 'public'
  icon: LucideIcon
  tone: 'emerald' | 'amber' | 'sky'
  label: string
  blurb: string
  auth: IrCallableAuth
}

/** The canonical callable authentication surface shared by Methods and Functions. */
export type AuthCallable = Pick<IrMethod, 'auth' | 'policy'> | Pick<IrFunction, 'auth' | 'policy'>

/** Select the exact runtime implementation overlay for one callable coordinate. */
export function handlerLinkFor(
  links: readonly HandlerLink[],
  owner: string,
  method: string,
  ownerKind: HandlerLink['ownerKind'],
): HandlerLink | undefined {
  return links.find(
    (link) => link.owner === owner && link.method === method && link.ownerKind === ownerKind,
  )
}

/** Derive the display verdict only from the canonical callable contract. */
export function methodAuth(method?: AuthCallable): AuthVerdict | null {
  const auth = method?.auth
  if (!auth) return null
  if (auth === 'anonymous') {
    return {
      level: 'public',
      icon: Globe,
      tone: 'sky',
      label: 'Anonymous',
      auth,
      blurb: 'The callable contract permits anonymous callers.',
    }
  }
  if (auth === 'authenticated') {
    return {
      level: 'authenticated',
      icon: UserRound,
      tone: 'amber',
      label: 'Authenticated',
      auth,
      blurb: 'The callable contract requires an authenticated principal.',
    }
  }
  return {
    level: 'secured',
    icon: ShieldCheck,
    tone: 'emerald',
    label: 'Authorized',
    auth,
    blurb: 'The callable contract requires authorization.',
  }
}

/** Abstract contracts and concrete operations have distinct glyphs. */
export function methodGlyph(method: IrMethod): { icon: LucideIcon; tone: string } {
  if (!method.executable) return { icon: Puzzle, tone: 'fn' }
  return { icon: Zap, tone: 'primary' }
}
