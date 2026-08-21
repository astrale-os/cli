import type { DomainBinding } from '@astrale-os/kernel-client/domain'
import type { ClientSession } from '@astrale-os/kernel-client/session'

import { bind } from '@astrale-os/kernel-client/domain'

const ADMIN_ORIGIN = 'admin.astrale.ai'

export type AdminBinding = DomainBinding

/** Bind the exact Admin revision installed on this source Kernel. */
export async function bindAdmin(session: ClientSession): Promise<AdminBinding> {
  const installed = await session.installed(ADMIN_ORIGIN)
  const binding = bind(session, installed)
  if (binding.$.publication?.origin !== ADMIN_ORIGIN || binding.$.origin !== ADMIN_ORIGIN) {
    throw new TypeError('Configured Admin target does not serve the Admin Domain.')
  }
  return binding
}
