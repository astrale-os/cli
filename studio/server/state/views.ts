/**
 * state/views.ts — resolve a view's LIVE serving URL from the instance it is
 * installed on. The kernel stamps each View node (/<origin>/core/views/<slug>)
 * with a `binding` prop = {"remoteUrl": "<svc-url>/ui/…"}; we read it back via
 * `astrale get` (read-only, no install needed). This is the GROUND TRUTH for
 * "where does this view actually run" — there is no local copy.
 */
import type { PreviewToken, ViewUrlResult } from '../../shared/types'

const BINDING_KEY = 'kernel.astrale.ai:interface.Function.property.binding'

/** Run an astrale CLI command, return trimmed stdout (or null on failure), killed past timeout. */
async function astraleText(args: string[], timeoutMs = 8000): Promise<string | null> {
  try {
    const proc = Bun.spawn(['astrale', ...args], { stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* already exited */
      }
    }, timeoutMs)
    try {
      const out = await new Response(proc.stdout).text()
      const code = await proc.exited
      return code === 0 ? out.trim() || null : null
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

/** The `iss` claim of a JWT = the kernel URL the token is for (e.g. https://mcac.eu.astrale.ai/api). */
function jwtIssuer(jwt: string): string | null {
  try {
    const payload = jwt.split('.')[1]
    const json = Buffer.from(payload, 'base64url').toString('utf8')
    const iss = JSON.parse(json)?.iss
    return typeof iss === 'string' ? iss : null
  } catch {
    return null
  }
}

/**
 * Mint a short-lived delegation token so the studio can act as the AUTHENTICATED shell
 * HOST for a live view preview. The studio's `astrale` CLI session is the source of auth;
 * `astrale token` mints a delegation for the active identity on the target instance. The
 * browser parent never calls the kernel — it just hands this token to the view iframe.
 */
export async function mintPreviewToken(
  origin: string | null,
  instance: string | null,
  slug: string,
  ttlSeconds = 1800,
): Promise<PreviewToken> {
  if (!origin || !instance || !slug)
    return { status: 'unavailable', reason: 'no target instance for this domain' }
  const token = await astraleText(
    ['token', '--ttl', String(ttlSeconds), '--raw', '-i', instance],
    12000,
  )
  if (!token || token.split('.').length !== 3)
    return {
      status: 'unavailable',
      reason: 'could not mint a token (instance unreachable or not authenticated)',
    }
  const kernelUrl = jwtIssuer(token)
  return {
    status: 'ok',
    token,
    expiresAt: Date.now() + ttlSeconds * 1000,
    kernelUrl: kernelUrl ?? '',
    functionId: `/${origin}/core/views/${slug}`,
  }
}

/**
 * @param origin    the domain origin (e.g. mcac.app)
 * @param instance  the instance to query (the domain's deploy target)
 * @param slug      the view slug (its key in views/index.ts)
 */
export async function resolveViewUrl(
  origin: string | null,
  instance: string | null,
  slug: string,
  timeoutMs = 8000,
): Promise<ViewUrlResult> {
  if (!origin || !instance || !slug) return { status: 'unknown' }
  try {
    const proc = Bun.spawn(
      ['astrale', 'get', `/${origin}/core/views/${slug}`, '-i', instance, '--json'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* already exited */
      }
    }, timeoutMs)
    try {
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      await proc.exited
      let parsed: any = null
      try {
        parsed = JSON.parse(out)
      } catch {
        /* non-JSON */
      }
      if (parsed?.error === 'NOT_FOUND' || /\bNOT_FOUND\b/.test(`${out}\n${err}`))
        return { status: 'not-installed' }
      if (parsed?.path) {
        let url: string | null = null
        const binding = parsed.props?.[BINDING_KEY]
        if (typeof binding === 'string') {
          try {
            const u = JSON.parse(binding)?.remoteUrl
            if (typeof u === 'string' && u) url = u
          } catch {
            /* malformed binding */
          }
        }
        return { status: 'installed', url }
      }
      return { status: 'unknown' }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return { status: 'unknown' }
  }
}
