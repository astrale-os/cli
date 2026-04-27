/**
 * End-to-end probe of the running local manager kernel.
 *
 * Exercises the same RPC surface the playground UI uses, through the typed
 * `kernel-client` proxy so the calls match the kernel schema by construction.
 *
 * Usage: from the playground directory, `bun scripts/e2e-manager.ts`
 * Requires a manager running at http://localhost:4400/mngt/
 * (start one with `astrale start`).
 */

import { ClientSession } from '@astrale-os/kernel-client/session'
import { KernelSchema } from '@astrale-os/kernel-core'
import { buildSpec } from '@astrale-os/sdk'
import { distributionDomain } from '@kernel-domains/distribution/domain'
import { importJWK, SignJWT } from 'jose'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MANAGER_URL = process.env.MANAGER_URL ?? 'http://localhost:4400/mngt/'
const ISSUER = MANAGER_URL.replace(/\/$/, '')
const KEYS_DIR = join(homedir(), '.astrale', 'keys')

// Mint a self-grant credential the same way the CLI does (`signAs` in
// cli/src/lib/keys.ts). Keeps the script self-contained without spawning
// `astrale token`, whose output omits the `grant` claim the kernel expects.
async function mintCredential(subject = 'manager'): Promise<string> {
  const privateJwk = JSON.parse(readFileSync(join(KEYS_DIR, 'manager.private.jwk'), 'utf-8'))
  const kid = privateJwk.kid ?? `${subject}-key`
  const privateKey = await importJWK(privateJwk, 'ES256')
  return new SignJWT({ grant: { v: 1, expr: { kind: 'identity', self: true } } })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer(ISSUER)
    .setSubject(subject)
    .setAudience(ISSUER)
    .sign(privateKey)
}

async function main(): Promise<void> {
  console.log(`[e2e] connecting to ${MANAGER_URL}`)
  const credential = await mintCredential()
  console.log(`[e2e] minted credential (${credential.slice(0, 20)}...)`)

  const session = new ClientSession({
    default: MANAGER_URL,
    identity: () => credential,
  })
  const kernel = session.withSchema(KernelSchema)

  // ── 1. List functions — smoke test the interface-method dispatch ──
  console.log('[e2e] calling /kernel.astrale.ai/interface.Function/list')
  try {
    const fns = await session.call('/kernel.astrale.ai/interface.Function/list', {})
    const count = Array.isArray(fns) ? fns.length : 'unknown-shape'
    console.log(`[e2e]   ✓ functions: ${count}`)
  } catch (err) {
    console.log(`[e2e]   ✗ list failed: ${(err as Error).message}`)
  }

  // ── 2. Install a sample domain via the typed proxy ──
  console.log('[e2e] building distribution domain spec')
  const spec = buildSpec(distributionDomain).toWire()
  console.log(`[e2e]   spec: ${spec.nodes.length} nodes, ${spec.edges.length} edges`)

  console.log('[e2e] calling Root.installDomain via typed proxy')
  try {
    const result = await kernel.static('Root').installDomain({ spec })
    console.log(`[e2e]   ✓ installed:`, result)
  } catch (err) {
    console.log(`[e2e]   ✗ install failed: ${(err as Error).message}`)
  }

  // ── 2b. Fallback: raw absolute path form used in s27-dispatch-methods ──
  console.log('[e2e] raw call /kernel.astrale.ai/class.Root/installDomain')
  try {
    const result = await session.call('/kernel.astrale.ai/class.Root/installDomain', { spec })
    console.log(`[e2e]   ✓ installed (raw):`, result)
  } catch (err) {
    console.log(`[e2e]   ✗ install (raw) failed: ${(err as Error).message}`)
  }

  // ── 3. Cypher query via Root.query ──
  console.log('[e2e] calling Root.query to count nodes')
  try {
    const rows = await kernel.static('Root').query({
      cypher: 'MATCH (n) RETURN count(n) AS total',
    })
    console.log(`[e2e]   ✓ query result:`, rows)
  } catch (err) {
    console.log(`[e2e]   ✗ query failed: ${(err as Error).message}`)
  }

  console.log('[e2e] raw call /kernel.astrale.ai/class.Root/query')
  try {
    const rows = await session.call('/kernel.astrale.ai/class.Root/query', {
      cypher: 'MATCH (n) RETURN count(n) AS total',
    })
    console.log(`[e2e]   ✓ query (raw) result:`, rows)
  } catch (err) {
    console.log(`[e2e]   ✗ query (raw) failed: ${(err as Error).message}`)
  }

  session.disconnect()
}

main().catch((err: Error) => {
  console.error('[e2e] fatal:', err)
  process.exit(1)
})
