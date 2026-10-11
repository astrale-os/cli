// Subprocess fixture: only HTTP is replaced. CLI identity, session ownership, credential
// selection, SDK serialization, command parsing, and stdout presentation are production code.
import { issuer } from '@astrale-os/sdk/auth'
import { Path } from '@astrale-os/sdk/graph/path'
import { bundle, defineSchema, func, schema } from '@astrale-os/sdk/schema'
import { appendFile } from 'node:fs/promises'

import { withResolvedClientSession } from '../../../connection/session'
import { createIdentity, readIdentities } from '../../../identity/registry'
import { readConfig } from '../../../lib/config'
import { InstallationCache } from '../../../state/installations'

const kernel = issuer.accept('https://kernel.example')
const remote = issuer.accept('https://jobs.example')
const mode = process.env.EXECUTION_FIXTURE_MODE ?? 'caller'
const observed = process.env.EXECUTION_FIXTURE_OBSERVED!
const installed = bundle.create(
  defineSchema('jobs.example', {
    name: 'Jobs',
    functions: {
      durable: func({
        auth: 'authenticated',
        execution: { durable: true },
        input: { type: 'object' },
        output: { type: 'object' },
      }),
    },
  }),
)
const revision = schema.revision(installed.root)
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = (claims: unknown) =>
  `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode(claims)}.signature`
async function record(event: unknown) {
  await appendFile(observed, `${JSON.stringify(event)}\n`)
}
const domain = {
  origin: 'jobs.example',
  revision,
  generation: `sha256:${'b'.repeat(64)}`,
  release:
    mode === 'stale'
      ? null
      : {
          origin: 'jobs.example',
          revision,
          digest: `sha256:${'c'.repeat(64)}`,
          identity: { issuer: remote, subject: 'jobs.example' },
        },
  readiness: `sha256:${'d'.repeat(64)}`,
  capabilities: { requested: {}, materialized: {} },
  bindings: { callables: [], views: [] },
}
let inspections = 0
// A synthetic transport response is the only server substitute; no real endpoint is contacted.
globalThis.fetch = (async (input, init) => {
  const url = String(input)
  let response: Response
  if (url === `${kernel}/invoke`) {
    const body = JSON.parse(await new Response(init?.body).text())
    const claims = JSON.parse(Buffer.from(body.credential.split('.')[1], 'base64url').toString())
    await record({
      kind: 'invoke',
      target: body.call.target,
      input: body.call.input,
      principal: claims.iss === remote ? 'domain' : 'caller',
    })
    const payload = body.call.input
    if (payload.kind === 'bundle' || payload.kind === 'inspect') {
      if (payload.kind === 'inspect') inspections++
      const current = mode === 'changed' && inspections > 1 ? { ...domain, release: null } : domain
      const result =
        payload.kind === 'bundle'
          ? { domain: current, bundle: bundle.serialize(installed) }
          : current
      response = new Response(JSON.stringify(result), {
        headers: {
          'content-type': 'application/vnd.astrale.schema-introspection.v4+json',
          'cache-control': 'no-store',
          'x-astrale-request-id': body.requestId,
          'x-astrale-binary-headers': '-',
          'x-astrale-invocation': `${encodeURIComponent(kernel)};schema-1`,
        },
      })
    } else {
      const target =
        typeof body.call.target === 'string' ? body.call.target : body.call.target.callable
      const answer = target.endsWith('function.durable')
        ? { execution: 'execution-1' }
        : {
            result: target.endsWith(':delegate')
              ? token({
                  iss: kernel,
                  sub: 'alice',
                  aud: remote,
                  exp: Math.floor(Date.now() / 1000) + 600,
                })
              : target.endsWith('.status')
                ? { state: 'completed' }
                : target.endsWith('.result')
                  ? { kind: 'completed', value: 42 }
                  : { id: 'alice' },
          }
      response = new Response(
        JSON.stringify({
          requestId: body.requestId,
          invocation: { source: kernel, id: 'invoke-1' },
          ...answer,
        }),
        {
          headers: {
            'content-type': new Headers(init?.headers).get('accept')!,
            'cache-control': 'no-store',
          },
        },
      )
    }
  } else if (url === `${remote}/.well-known/openid-configuration`) {
    await record({ kind: 'discovery', url })
    response =
      mode === 'stale' || mode === 'changed'
        ? new Response('retired', { status: 404 })
        : new Response(
            JSON.stringify({
              issuer: remote,
              jwks_uri: `${remote}/.well-known/jwks.json`,
              subject_types_supported: ['public'],
              id_token_signing_alg_values_supported: ['EdDSA'],
              token_exchange_endpoint: `${remote}/.well-known/astrale/token`,
            }),
            { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
          )
  } else if (url === `${remote}/.well-known/astrale/token`) {
    await record({ kind: 'exchange', url })
    const exp = Math.floor(Date.now() / 1000) + 600
    const proof = token({
      iss: kernel,
      sub: 'alice',
      aud: kernel,
      exp,
      delegation: { v: 1, expr: { kind: 'identity', id: 'alice' } },
    })
    response = new Response(
      JSON.stringify({
        token: token({
          iss: remote,
          sub: 'jobs-domain',
          aud: kernel,
          exp,
          grant: { v: 1, expr: { kind: 'identity', credential: proof } },
        }),
        expiresAt: exp,
      }),
      { headers: { 'content-type': 'application/vnd.astrale+json', 'cache-control': 'no-store' } },
    )
  } else throw new Error(`Unexpected fixture request ${url}`)
  Object.defineProperty(response, 'url', { value: url })
  return response
}) as typeof fetch

if (!(await readIdentities()).identities.alice) await createIdentity('alice', { issuer: kernel })
const cache = new InstallationCache()
if (process.argv[2] === 'probe-stale') {
  await cache.set(kernel, 'jobs.example', { issuer: remote })
  const result = await withResolvedClientSession(
    { url: kernel, kernelIssuer: kernel },
    { as: 'alice' },
    await readConfig(),
    async (ctx) => {
      let unavailable = false
      try {
        ctx.credentialPrincipal()
      } catch {
        unavailable = true
      }
      await ctx.session.call({
        target: Path.parse('/:jobs.example:function.ordinary').raw,
        input: {},
      })
      return { unavailable, principal: ctx.credentialPrincipal() }
    },
    undefined,
    { principal: 'callable', path: Path.parse('/:jobs.example:function.ordinary') },
    cache,
  )
  console.log(JSON.stringify(result))
} else {
  if (process.argv[2] === 'call')
    await cache.set(kernel, 'jobs.example', { issuer: mode === 'caller' ? null : remote })
  const { buildProgram } = await import('../../../program/index')
  await (await buildProgram()).parseAsync(['node', 'astrale', ...process.argv.slice(2)])
}
