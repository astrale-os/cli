import type { AstraleConfig } from '../lib/config'

import { AuthError } from '../errors'
import { getDefault, getIdentity } from '../lib/identity'
import { signAs } from '../lib/keys'
import { KEYS_DIR } from '../lib/paths'

/**
 * Resolve a signed JWT credential from CLI options.
 * Uses --as identity if provided, otherwise the default identity.
 */
export async function resolveCredential(
  opts: { as?: string },
  config: AstraleConfig,
): Promise<string> {
  try {
    const identity = opts.as ? await getIdentity(opts.as) : await getDefault()
    return await signAs(identity.subject, KEYS_DIR, { issuer: config.issuer })
  } catch (e) {
    throw new AuthError(e instanceof Error ? e.message : 'Failed to resolve credentials')
  }
}
