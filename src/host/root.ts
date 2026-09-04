import { calculateJwkThumbprint } from 'jose'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import type { ConnectionContext } from '../connection'

import { AstraleError } from '../errors'
import {
  createRootIdentityRecipient,
  decodeRootIdentityTransfer,
  importIdentity,
  readIdentities,
} from '../identity'
import { fetchWithCaFile } from '../lib/ca-fetch'
import { readInstances, upsertInstance } from '../lib/instance'
import { checkIssuerReachability } from '../lib/meta'
import { ExchangeCredentialCache } from '../state'
import { SESSION_ROUTE_STORE } from '../state/session-routes'
import { hostCall, type HostInstance } from './instance'

const transferSchema = z
  .object({
    format: z.literal('astrale.instance-root-transfer'),
    version: z.literal(1),
    requestId: z.string(),
    instance: z.string(),
    binding: z.string(),
    issuer: z.url(),
    subject: z.string(),
    recipientThumbprint: z.string(),
    jwe: z.string().max(16_384),
  })
  .strict()

const defaults = {
  readInstances,
  readIdentities,
  createRootIdentityRecipient,
  decodeRootIdentityTransfer,
  importIdentity,
  upsertInstance,
  checkIssuerReachability,
  fetchWithCaFile,
  clearCaches: async () => {
    await new ExchangeCredentialCache().clear()
    SESSION_ROUTE_STORE.clear()
  },
}

/** Import a sealed child root and inherit only the manager's TLS trust. */
export async function connectHostChild(
  context: ConnectionContext,
  host: string,
  instance: HostInstance,
  dependencies: Partial<typeof defaults> = {},
) {
  const deps = { ...defaults, ...dependencies }
  const bookmark = `${host}-${instance.slug}`
  const name = `${bookmark}-root`
  const existing = (await deps.readInstances()).instances[bookmark]
  if (
    existing &&
    (existing.url !== instance.issuer ||
      (existing.issuer !== undefined && existing.issuer !== instance.issuer))
  ) {
    throw new AstraleError(
      'HOST_BOOKMARK_CONFLICT',
      `Bookmark ${bookmark} belongs to another Kernel.`,
    )
  }
  const previous = (await deps.readIdentities()).identities[name]
  if (previous && (previous.source === 'idp' || previous.issuer !== instance.issuer)) {
    throw new AstraleError('HOST_IDENTITY_CONFLICT', `Identity ${name} belongs to another caller.`)
  }
  const recipient = await deps.createRootIdentityRecipient()
  const requestId = randomUUID()
  const transfer = transferSchema.parse(
    await hostCall(context, `${instance.instance}::exportRootIdentity`, {
      requestId,
      binding: instance.instance,
      recipient: recipient.recipient,
    }),
  )
  if (transfer.binding !== instance.instance)
    throw new AstraleError('HOST_TRANSFER_INVALID', 'Root transfer binding differs from the child.')
  const envelope = await deps.decodeRootIdentityTransfer(transfer, recipient, {
    instance: instance.instance,
    issuer: instance.issuer,
    requestId,
    recipientThumbprint: recipient.recipient.kid,
    subject: transfer.subject,
  })
  const caFile = context.target.caFile
  const { keys } = await deps.checkIssuerReachability(
    instance.issuer,
    instance.issuer,
    caFile ? deps.fetchWithCaFile(caFile) : undefined,
  )
  const subjects = await Promise.all(keys.map((key) => calculateJwkThumbprint(key, 'sha256')))
  if (!subjects.includes(envelope.subject))
    throw new AstraleError(
      'HOST_ROOT_MISMATCH',
      'The child JWKS does not publish its transferred root identity.',
    )
  const identity = await deps.importIdentity(envelope, {
    name,
    issuer: instance.issuer,
    replace: previous !== undefined,
  })
  await deps.clearCaches()
  await deps.upsertInstance(
    bookmark,
    {
      url: instance.issuer,
      issuer: instance.issuer,
      name: bookmark,
      kind: 'bookmark',
      mode: 'remote',
      defaultIdentity: name,
      ...(caFile === undefined ? {} : { caFile }),
    },
    { activateWhenEmpty: false, requireSameTarget: true },
  )
  return {
    host,
    instance: instance.instance,
    slug: instance.slug,
    url: instance.issuer,
    bookmark,
    identity: name,
    subject: identity.subject,
    state: 'ready',
    verification: 'live-jwks',
  } as const
}
