import type { CommandDefinition } from '../../command'

import {
  fetchOidcMetadata,
  readIdpConfigOrBuiltin,
  upsertIdpConfig,
  workosAuthKitMetadata,
} from '../../lib/idp'
import { log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS } from '../../lib/output'

export default {
  name: 'refresh',
  description: 'Refresh discovery metadata for an identity provider',
  arguments: [{ name: 'name', description: 'Local IdP registry name' }],
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (name: string, opts: { raw?: boolean; json?: boolean }) => {
    const existing = await readIdpConfigOrBuiltin(name)
    const metadata =
      existing.client.token_response === 'workos-authkit'
        ? workosAuthKitMetadata(existing.entry.issuer)
        : await fetchOidcMetadata(existing.entry.issuer)
    const idp = await upsertIdpConfig({
      name,
      metadata,
      client: existing.client,
      builtIn: existing.entry.builtIn,
    })

    if (isMachine(opts)) {
      output(idp, opts)
      return
    }

    log.success(`IdP "${name}" discovery metadata refreshed`)
    log.dim(`  issuer: ${idp.metadata.issuer}`)
  },
} satisfies CommandDefinition
