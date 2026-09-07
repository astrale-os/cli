import type { IssuerId, JsonWebKey, RegisterRequest } from '@astrale-os/sdk/auth'
import type { NodeId } from '@astrale-os/sdk/graph/node'
import type { JWK } from 'jose'

import { register, jwk } from '@astrale-os/sdk/auth'
import { Path } from '@astrale-os/sdk/graph/path'
import { importJWK, SignJWT } from 'jose'
import { readFile } from 'node:fs/promises'

import type { KernelCommandOpts } from '../../connection'
import type { IdentityRegistrationResult } from '../../identity/index'
import type { CommandDefinition } from '../../program/index'

import { registrationKeyForTarget, runKernelCommand } from '../../connection'
import { AstraleError, IdentityKeypairIncompleteError } from '../../errors'
import { getIdentity, setRegistration, submitIdentityRegistration } from '../../identity/index'
import { fileExists, keypairPaths } from '../../keys/index'
import { derivedIdempotencyKey } from '../../lib/idempotency'
import { fatal, log } from '../../lib/log'
import { output } from '../../lib/output'

type RegisterOpts = KernelCommandOpts & {
  node?: string
  via?: string
}

async function readJwk(path: string): Promise<JWK> {
  return JSON.parse(await readFile(path, 'utf8')) as JWK
}

export default {
  name: 'register',
  description: 'Register a local key identity on an existing Identity Node',
  afterHelpText: `
Prerequisite:
  Create the local key identity first. Register never creates or replaces the
  local identity or its keypair.

  $ astrale identity create alice

Behavior:
  --node @node-id selects an existing Identity Node. This command never creates
  a Node, changes business properties, or assigns a Group. Create the business
  object separately, then register its returned Node ID.

  By default the authenticated caller submits the request directly to Kernel
  Auth.register. Use --via when a Domain callable supplies the required authority.
  The CLI sends the exact self-proven request through that callable, then admits
  its result and stores the same target-bound registration. The callable owns
  authorization; the CLI never receives installed Domain authority.

  The primary self proof is signed for the target Kernel audience. A stable
  request key allows retrying the same registration without creating anything.
  The result must match the selected Node and expected (issuer, subject).

Example:
  $ astrale identity register alice --node @existing-user-id -i staging
  $ astrale identity register responder --node @existing-operator-id \
      --via /:ops.example:function.registerOperator -i staging
`,
  arguments: [{ name: 'name', description: 'Existing local identity name', required: true }],
  options: [
    {
      flags: '--node <nodePath>',
      description: 'Existing Identity Node as @node-id (required)',
    },
    {
      flags: '--via <callablePath>',
      description: 'Submit the self-proven request through an authorizing Domain callable',
    },
  ],
  action: async (name: string, opts: RegisterOpts) => {
    try {
      if (!opts.node) throw new TypeError('Missing required flag: --node <nodePath>')
      const nodeId = registrationNodeId(opts.node)
      const identity = await getIdentity(name)
      if ((identity.source ?? 'key') !== 'key') {
        throw new AstraleError(
          'INVALID_IDENTITY_SOURCE',
          `Identity "${name}" is IdP-backed and cannot be registered as a local key identity.`,
          'Run: astrale identity create <local-name>',
        )
      }
      const { privatePath, publicPath } = keypairPaths(identity.subject)
      const [hasPrivateKey, hasPublicKey] = await Promise.all([
        fileExists(privatePath),
        fileExists(publicPath),
      ])
      if (!hasPrivateKey || !hasPublicKey) {
        throw new IdentityKeypairIncompleteError(
          identity.subject,
          [!hasPrivateKey && 'private', !hasPublicKey && 'public'].filter(
            (component): component is 'private' | 'public' => component !== false,
          ),
        )
      }

      const privateKey = await readJwk(privatePath)
      const publicKey = jwk.acceptPublic(await readJwk(publicPath))

      await runKernelCommand<IdentityRegistrationResult>({
        opts,
        label: `Register "${name}"`,
        fn: async ({ auth, session, target }) => {
          const registrationKey = registrationKeyForTarget(target)
          const prepared = await prepareIdentityRegistration({
            nodeId,
            privateKey,
            publicKey,
            kernelIssuer: target.kernelIssuer,
          })
          const registered = await submitIdentityRegistration({
            request: prepared.request,
            nodeId,
            expectedAuthentication: prepared.authentication,
            ...(opts.via === undefined ? {} : { via: opts.via }),
            direct: auth,
            callable: session,
          })
          await setRegistration(name, registrationKey, {
            iss: registered.iss,
            sub: registered.sub,
            registeredAt: new Date().toISOString(),
          })
          return registered
        },
        format: formatIdentityRegistration,
      })
    } catch (error) {
      fatal(error, opts)
    }
  },
} satisfies CommandDefinition

/** Preserve one structured stdout value while retaining useful detail in the human view. */
export function formatIdentityRegistration(
  result: IdentityRegistrationResult,
  format: KernelCommandOpts,
  machine: boolean,
): void {
  output(result, format)
  if (machine) return
  log.dim(`  iss=${result.iss}`)
  log.dim(`  sub=${result.sub}`)
}

export function registrationNodeId(input: string): NodeId {
  const { anchor, steps } = Path.parse(input).ast
  if (anchor.kind !== 'id' || steps.length !== 0 || input === '@self') {
    throw new TypeError('--node requires an explicit existing @node-id.')
  }
  return anchor.id
}

/** Prove a key for one existing Node; registration never allocates graph state. */
export async function prepareIdentityRegistration(input: {
  readonly nodeId: NodeId
  readonly privateKey: JWK
  readonly publicKey: JsonWebKey
  readonly kernelIssuer: IssuerId
}): Promise<{
  readonly request: RegisterRequest
  readonly authentication: { readonly iss: IssuerId; readonly sub: 'self' }
}> {
  const issuer = await register.selfIssuer(input.kernelIssuer, input.publicKey)
  const registrationKey = await derivedIdempotencyKey(
    'identity-register',
    JSON.stringify([input.kernelIssuer, input.nodeId, issuer, input.publicKey.kid ?? null]),
  )
  const proof = await mintRegistrationProof(input.privateKey, issuer, input.kernelIssuer)
  return {
    authentication: Object.freeze({ iss: issuer, sub: 'self' }),
    request: {
      idempotencyKey: registrationKey,
      identities: [
        {
          id: input.nodeId,
          mode: 'self',
          publicKey: input.publicKey,
          credential: proof,
        },
      ],
    },
  }
}

async function mintRegistrationProof(
  privateKey: JWK,
  issuer: string,
  audience: string,
): Promise<string> {
  const key = await importJWK(privateKey, 'ES256')
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', ...(privateKey.kid ? { kid: privateKey.kid } : {}) })
    .setIssuer(issuer)
    .setSubject('self')
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}
