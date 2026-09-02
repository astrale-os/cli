import type { HandlerLink, IrCallableAuth, IrFunction, IrMethod } from '@shared/types'

import { Globe, ShieldCheck, type LucideIcon } from 'lucide-react'

export interface AuthVerdict {
  level: 'secured' | 'public'
  icon: LucideIcon
  tone: 'emerald' | 'sky'
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
  return {
    level: 'secured',
    icon: ShieldCheck,
    tone: 'emerald',
    label: auth === 'authorized' ? 'Authorized' : 'Authenticated',
    auth,
    blurb:
      auth === 'authorized'
        ? 'The callable contract requires authorization.'
        : 'The callable contract requires an authenticated principal.',
  }
}
