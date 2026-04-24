import { fileExists, keypairPaths, loadAuth, resolveAuth } from '@astrale-os/astrale/keys'
import { KEYS_DIR } from '@astrale-os/astrale/paths'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

/**
 * Mint an audience-scoped credential for the caller. Mirror of the
 * playground's server fn — reads the bind-mounted keys and signs a fresh
 * JWT. Refuses unknown audiences (no keypair = implicit whitelist).
 */
export const getCredential = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      aud: z.string().url(),
    }),
  )
  .handler(async ({ data }) => {
    const managerIssuer = process.env.ASTRALE_MANAGER_ISSUER ?? 'http://localhost:4400/mngt'
    if (data.aud === managerIssuer) {
      const bound = await resolveAuth(KEYS_DIR, { issuer: data.aud, subject: 'manager' })
      return { credential: bound.credential }
    }
    const u = new URL(data.aud)
    const subject =
      u.pathname
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .pop() ?? ''
    if (!subject) throw new Error('invalid audience: no subject in path')
    // Fall back to the "manager" identity for child instances that don't
    // have a dedicated keypair minted yet (dev convenience).
    const { privatePath } = keypairPaths(subject, KEYS_DIR)
    const effectiveSubject = (await fileExists(privatePath)) ? subject : 'manager'
    const bound = await loadAuth(KEYS_DIR, { issuer: data.aud, subject: effectiveSubject })
    return { credential: bound.credential }
  })
