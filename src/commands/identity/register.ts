import type { IssuerId, JsonWebKey, ProvisionRequest } from '@astrale-os/sdk/auth'
import type { ClassKey as ClassKeyValue } from '@astrale-os/sdk/graph/class'
import type { JWK } from 'jose'

import { provision, jwk } from '@astrale-os/sdk/auth'
import { LocalBinding } from '@astrale-os/sdk/graph'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { MutationAST } from '@astrale-os/sdk/mutation'
import { importJWK, SignJWT } from 'jose'
import { readFile } from 'node:fs/promises'

import type { KernelCommandOpts } from '../../connection'
import type { IdentityRegistrationResult } from '../../identity/index'
import type { CommandDefinition } from '../../program/index'

import { registrationKeyForTarget, runKernelCommand } from '../../connection'
import { AstraleError, IdentityKeypairIncompleteError } from '../../errors'
import { classKey } from '../../graph'
import { getIdentity, setRegistration, submitIdentityProvision } from '../../identity/index'
import { fileExists, keypairPaths } from '../../keys/index'
import { derivedIdempotencyKey } from '../../lib/idempotency'
import { fatal, log } from '../../lib/log'
import { output } from '../../lib/output'

type RegisterOpts = KernelCommandOpts & {
  class?: string
  props?: string
  via?: string
}

async function readJwk(path: string): Promise<JWK> {
  return JSON.parse(await readFile(path, 'utf8')) as JWK
}

export default {
  name: 'register',
  description: 'Register an existing local key identity through one atomic provision',
  afterHelpText: `
Prerequisite:
  Create the local key identity first. Register never creates or replaces the
  local identity or its keypair.

  $ astrale identity create alice

Behavior:
  Uses the existing local keypair to create one Node through Mutation V3 and
  designates it as a self-proven Identity in the same atomic Auth.provision
  request. --class is required; --props must use fully-qualified Property keys
  owned by that Class.

  By default the authenticated caller submits the request directly to Kernel
  Auth.provision. Use --via for an application-owned identity Class: the CLI
  sends the exact self-proven request through that Domain callable, then admits
  its result and stores the same target-bound registration. The callable owns
  authorization; the CLI never receives installed Domain authority.

  The Kernel assigns each Node ID; callers do not choose a storage path. The
  CLI binds the key proof to the exact provision fingerprint and target Kernel
  audience, then caches the returned (issuer, subject) for subsequent calls.

Example:
  $ astrale identity register alice --class /:accounts.example:class.User \
      --props '{"accounts.example:class.User.property.name":"Alice"}' -i staging
  $ astrale identity register responder --class /:ops.example:class.Operator \
      --via /:ops.example:function.provisionOperator -i staging
`,
  arguments: [{ name: 'name', description: 'Existing local identity name', required: true }],
  options: [
    {
      flags: '--class <classPath>',
      description: 'Exact Class of the identity-bearing Node (required)',
    },
    {
      flags: '--props <json>',
      description: 'Fully-qualified canonical properties for the new Node',
    },
    {
      flags: '--via <callablePath>',
      description: 'Submit the self-proven request through an authorizing Domain callable',
    },
  ],
  action: async (name: string, opts: RegisterOpts) => {
    try {
      if (!opts.class) throw new TypeError('Missing required flag: --class <classPath>')
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
      const classPath = classKey(opts.class, '--class')
      const properties = normalizeProperties(opts.props ? JSON.parse(opts.props) : {})

      await runKernelCommand<IdentityRegistrationResult>({
        opts,
        label: `Register "${name}"`,
        fn: async ({ auth, session, target }) => {
          const registrationKey = registrationKeyForTarget(target)
          const existing = identity.registrations?.[registrationKey]
          if (existing) {
            log.warn(`"${name}" is already registered on "${registrationKey}"`)
            return existing
          }

          const prepared = await prepareIdentityProvision({
            name,
            classPath,
            properties,
            privateKey,
            publicKey,
            kernelIssuer: target.kernelIssuer,
          })
          const registered = await submitIdentityProvision({
            request: prepared.request,
            binding: prepared.binding,
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

/** Build and self-prove one exact canonical provision request for the target Kernel. */
export async function prepareIdentityProvision(input: {
  readonly name: string
  readonly classPath: ClassKeyValue
  readonly properties: ReturnType<typeof normalizeProperties>
  readonly privateKey: JWK
  readonly publicKey: JsonWebKey
  readonly kernelIssuer: IssuerId
}): Promise<{
  readonly binding: ReturnType<typeof LocalBinding>
  readonly request: ProvisionRequest
  readonly authentication: { readonly iss: IssuerId; readonly sub: 'self' }
}> {
  const binding = LocalBinding('identity')
  const mutation = MutationAST.build((builder) => {
    builder.createNode({ as: binding, class: input.classPath, props: input.properties })
    return undefined
  })
  const registrationKey = await derivedIdempotencyKey('identity-register', input.name)
  const unsigned = provision.accept({
    idempotencyKey: registrationKey,
    mutation,
    identities: [
      {
        identity: { created: binding },
        authentication: {
          credentials: { publicKey: input.publicKey, proof: 'pending-proof' },
        },
      },
    ],
  })
  const fingerprint = await provision.fingerprint(unsigned)
  const issuer = await provision.selfIssuer(input.kernelIssuer, input.publicKey)
  const proof = await mintProvisionProof(input.privateKey, issuer, input.kernelIssuer, fingerprint)
  return {
    binding,
    authentication: Object.freeze({ iss: issuer, sub: 'self' }),
    request: provision.accept({
      idempotencyKey: registrationKey,
      mutation,
      identities: [
        {
          identity: { created: binding },
          authentication: { credentials: { publicKey: input.publicKey, proof } },
        },
      ],
    }),
  }
}

async function mintProvisionProof(
  privateKey: JWK,
  issuer: string,
  audience: string,
  fingerprint: string,
): Promise<string> {
  const key = await importJWK(privateKey, 'ES256')
  return new SignJWT({ provision: fingerprint })
    .setProtectedHeader({ alg: 'ES256', ...(privateKey.kid ? { kid: privateKey.kid } : {}) })
    .setIssuer(issuer)
    .setSubject('self')
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}
