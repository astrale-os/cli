import { readFile } from 'node:fs/promises'
import { z } from 'zod'

import type { FileLockOptions } from './files'

import { atomicWrite, withFileLock } from './files'
import { paths } from './paths'

export const IDENTITY_STORE_VERSION = 1 as const

type IdentityStateErrorCode =
  | 'IDENTITY_STATE_INVALID'
  | 'IDENTITY_STATE_VERSION_UNSUPPORTED'
  | 'IDENTITY_STATE_UNREADABLE'

export class IdentityStateError extends Error {
  readonly code: IdentityStateErrorCode
  readonly path: string

  constructor(code: IdentityStateErrorCode, path: string, message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'IdentityStateError'
    this.code = code
    this.path = path
  }
}

export interface IdentityStoreOptions {
  readonly path?: string
  readonly now?: () => Date
  readonly lock?: FileLockOptions
}

interface IdentityUpdate<Value> {
  readonly next: IdentityStore
  readonly value: Value
}

const RegistrationSchema = z
  .object({
    iss: z.string(),
    sub: z.string(),
    registeredAt: z.string(),
  })
  .strict()

const IdentitySchema = z
  .object({
    subject: z.string(),
    createdAt: z.string(),
    source: z.enum(['key', 'idp']).optional(),
    mode: z.enum(['local', 'remote']).optional(),
    kid: z.string().optional(),
    idp: z.string().optional(),
    issuer: z.string().url().optional(),
    audience: z.string().optional(),
    claims: z.record(z.string(), z.unknown()).optional(),
    registrations: z.record(z.string(), RegistrationSchema).optional(),
  })
  .strict()

const IdentityFileV1Schema = z
  .object({
    version: z.literal(IDENTITY_STORE_VERSION),
    default: z.string(),
    identities: z.record(z.string(), IdentitySchema),
  })
  .strict()

export type Registration = z.infer<typeof RegistrationSchema>
export type Identity = z.infer<typeof IdentitySchema>
export type IdentityMode = NonNullable<Identity['mode']>
export type IdentityStore = Omit<z.infer<typeof IdentityFileV1Schema>, 'version'>

export async function readIdentityStore(
  options: IdentityStoreOptions = {},
): Promise<IdentityStore> {
  const path = options.path ?? paths.identities
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return { default: '', identities: {} }
    throw new IdentityStateError(
      'IDENTITY_STATE_UNREADABLE',
      path,
      `Could not read identity state at ${path}`,
      error,
    )
  }

  let input: unknown
  try {
    input = JSON.parse(raw)
  } catch (error) {
    throw invalidState(path, error)
  }
  const version =
    typeof input === 'object' && input !== null && Object.hasOwn(input, 'version')
      ? (input as { readonly version: unknown }).version
      : undefined
  if (version === undefined) {
    throw new IdentityStateError(
      'IDENTITY_STATE_VERSION_UNSUPPORTED',
      path,
      `Identity state at ${path} has no supported version. Rename this file to preserve it, then run astrale auth login or astrale identity create. Keep the keys directory unchanged.`,
    )
  }
  if (typeof version !== 'number' || !Number.isInteger(version)) throw invalidState(path)
  if (version !== IDENTITY_STORE_VERSION) {
    throw new IdentityStateError(
      'IDENTITY_STATE_VERSION_UNSUPPORTED',
      path,
      `Identity state at ${path} uses unsupported version ${version}`,
    )
  }
  try {
    const { version: _, ...store } = IdentityFileV1Schema.parse(input)
    return store
  } catch (error) {
    throw invalidState(path, error)
  }
}

export async function updateIdentityStore<Value>(
  transition: (current: IdentityStore) => IdentityUpdate<Value> | Promise<IdentityUpdate<Value>>,
  options: IdentityStoreOptions = {},
): Promise<Value> {
  const path = options.path ?? paths.identities
  return withFileLock(
    `${path}.lock`,
    async () => {
      const update = await transition(await readIdentityStore(options))
      await atomicWrite(
        path,
        `${JSON.stringify({ version: IDENTITY_STORE_VERSION, ...update.next }, null, 2)}\n`,
      )
      return update.value
    },
    options.lock,
  )
}

function invalidState(path: string, cause?: unknown): IdentityStateError {
  return new IdentityStateError(
    'IDENTITY_STATE_INVALID',
    path,
    `Identity state at ${path} is malformed`,
    cause,
  )
}
