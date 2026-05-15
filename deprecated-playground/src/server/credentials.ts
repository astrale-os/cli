import { fileExists, keypairPaths, loadAuth, resolveAuth } from '@astrale-os/astrale/keys'
import { KEYS_DIR } from '@astrale-os/astrale/paths'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

/**
 * Mint an audience-scoped credential for the caller.
 *
 * Flow:
 *  - If `aud` is the manager's issuer → load the manager's own keypair and
 *    return a self-issued credential.
 *  - Otherwise derive the subject from the last non-empty path segment of
 *    the audience URL (e.g. `http://localhost:4400/aaa` → `aaa`) and refuse
 *    the request if no keypair exists for that subject (implicit whitelist
 *    of legitimate instances).
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
    const subject = new URL(data.aud).pathname.split('/').filter(Boolean).at(-1)
    if (!subject) throw new Error('invalid audience: no subject in path')
    const { privatePath } = keypairPaths(subject, KEYS_DIR)
    if (!(await fileExists(privatePath))) {
      throw new Error(`no keypair for subject "${subject}"`)
    }
    const bound = await loadAuth(KEYS_DIR, { issuer: data.aud, subject })
    return { credential: bound.credential }
  })
