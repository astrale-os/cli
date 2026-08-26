import type { HostCapabilities } from '@astrale-os/shell'

import { admitHostCapabilities } from '@astrale-os/shell'

/** Build the exact host grant handed to a CLI-hosted View session. */
export function viewHostCapabilities(externalOrigins: readonly string[]): HostCapabilities {
  return admitHostCapabilities({
    version: 1,
    navigation: {
      openView: {},
      ...(externalOrigins.length === 0 ? {} : { external: { origins: externalOrigins } }),
    },
    actions: {},
    browser: {},
    access: {},
  })
}
