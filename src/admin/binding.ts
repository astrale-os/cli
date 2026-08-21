import type { ClientSession } from '@astrale-os/kernel-client/session'
import type { DomainBinding } from '@astrale-os/shell'

import { bindDomain } from '@astrale-os/shell'

const ADMIN_ORIGIN = 'admin.astrale.ai'

export type AdminBinding = DomainBinding

/** Bind the exact Admin revision installed on this source Kernel. */
export async function bindAdmin(session: ClientSession): Promise<AdminBinding> {
  const installed = await session.installation(ADMIN_ORIGIN)
  const binding = await bindDomain(session, installed.bundle.root)
  if (binding.$.publication?.origin !== ADMIN_ORIGIN || binding.$.origin !== ADMIN_ORIGIN) {
    throw new TypeError('Configured Admin target does not serve the Admin Domain.')
  }
  return binding
}
