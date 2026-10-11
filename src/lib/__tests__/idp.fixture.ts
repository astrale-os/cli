import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** An unsigned JWT: the CLI reads its claims, the IdP alone would verify a signature. */
export function unsignedJwt(payload: Record<string, unknown>): string {
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return [segment({ alg: 'none', typ: 'JWT' }), segment(payload), ''].join('.')
}

/** Register the IdP `test` at `issuer` in the CLI home `home`, with its OAuth client. */
export async function writeIdp(
  home: string,
  issuer: string,
  client: Record<string, string> = { client_id: 'c_1' },
): Promise<void> {
  const directory = join(home, 'idps', 'test')
  const at = '2026-01-01T00:00:00.000Z'
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(home, 'idps', 'index.json'),
    JSON.stringify({ idps: { test: { issuer, createdAt: at, updatedAt: at } } }),
  )
  await writeFile(
    join(directory, 'metadata.json'),
    JSON.stringify({ issuer, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }),
  )
  await writeFile(join(directory, 'client.json'), JSON.stringify(client))
}

type Answer = (form: URLSearchParams) => Promise<Response | undefined> | Response | undefined

/**
 * A WorkOS-style token endpoint. A refresh token is single-use: presenting anything but the current
 * one is invalid_grant. `answer` may respond first (an outage, a concurrent rotation); `mint` names
 * each access token.
 */
export function tokenEndpoint(
  options: {
    readonly mint?: (form: URLSearchParams, refreshes: number) => string
    readonly answer?: Answer
  } = {},
) {
  let current = 'rt-0'
  let refreshes = 0
  let answer = options.answer
  const forms: URLSearchParams[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname !== '/token')
        return new Response('missing', { status: 404 })
      const form = new URLSearchParams(await request.text())
      forms.push(form)
      const answered = await answer?.(form)
      if (answered !== undefined) return answered
      if (form.has('refresh_token')) {
        if (form.get('refresh_token') !== current) {
          return Response.json(
            { error: 'invalid_grant', error_description: 'Refresh token already exchanged.' },
            { status: 400 },
          )
        }
        current = `rt-${++refreshes}`
      }
      return Response.json({
        access_token: options.mint?.(form, refreshes) ?? `rotated-access-${refreshes}`,
        refresh_token: current,
        token_type: 'Bearer',
        expires_in: 3600,
      })
    },
  })
  return {
    url: `http://${server.hostname}:${server.port}`,
    forms,
    refreshCount: () => refreshes,
    answer: (next: Answer | undefined) => void (answer = next),
    stop: () => server.stop(true),
  }
}
