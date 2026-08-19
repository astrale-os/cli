import { readFile } from 'node:fs/promises'
import { z } from 'zod'

import type { FileLockOptions } from './files'

import { atomicWrite, withFileLock } from './files'
import { IDENTITIES_PATH } from './paths'

export type IdentitySource = 'key' | 'idp'
export type IdentityMode = 'local' | 'remote'

export interface Registration {
  readonly iss: string
  readonly sub: string
  readonly registeredAt: string
}

export interface Identity {
  readonly subject: string
  readonly createdAt: string
  readonly source?: IdentitySource
  readonly mode?: IdentityMode
  readonly kid?: string
  readonly idp?: string
  readonly issuer?: string
  readonly audience?: string
  readonly claims?: Readonly<Record<string, unknown>>
  readonly registrations?: Readonly<Record<string, Registration>>
}

export interface IdentityStore {
  readonly default: string
  readonly identities: Readonly<Record<string, Identity>>
}

export const IDENTITY_STORE_VERSION = 1 as const

export type IdentityStateErrorCode =
  | 'IDENTITY_STATE_INVALID'
  | 'IDENTITY_STATE_VERSION_UNSUPPORTED'
  | 'IDENTITY_STATE_UNREADABLE'
  | 'IDENTITY_STATE_BACKUP_CONFLICT'

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

export interface IdentityUpdate<Value> {
  readonly next: IdentityStore
  readonly value: Value
}

const RegistrationSchema: z.ZodType<Registration> = z
  .object({
    iss: z.string(),
    sub: z.string(),
    registeredAt: z.string(),
  })
  .strict()

const IdentitySchema: z.ZodType<Identity> = z
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

const IdentityStoreFields = {
  default: z.string(),
  identities: z.record(z.string(), IdentitySchema),
}

const IdentityStoreSchema: z.ZodType<IdentityStore> = z.object(IdentityStoreFields).strict()

const IdentityFileV1Schema = z
  .object({ version: z.literal(IDENTITY_STORE_VERSION), ...IdentityStoreFields })
  .strict()

interface DecodedIdentityStore {
  readonly store: IdentityStore
  readonly legacyBytes?: string
}

export async function readIdentityStore(
  options: IdentityStoreOptions = {},
): Promise<IdentityStore> {
  return (await readDecoded(options)).store
}

export async function updateIdentityStore<Value>(
  transition: (current: IdentityStore) => IdentityUpdate<Value> | Promise<IdentityUpdate<Value>>,
  options: IdentityStoreOptions = {},
): Promise<Value> {
  const path = options.path ?? IDENTITIES_PATH
  return withFileLock(
    `${path}.lock`,
    async () => {
      const current = await readDecoded(options)
      const update = await transition(current.store)
      if (current.legacyBytes !== undefined) {
        await preserveLegacyBackup(path, current.legacyBytes)
      }
      await atomicWrite(path, encodeV1(update.next))
      return update.value
    },
    options.lock,
  )
}

async function readDecoded(options: IdentityStoreOptions): Promise<DecodedIdentityStore> {
  const path = options.path ?? IDENTITIES_PATH
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return { store: seed(options.now?.() ?? new Date()) }
    }
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

  if (hasVersion(input)) {
    if (typeof input.version !== 'number' || !Number.isInteger(input.version)) {
      throw invalidState(path)
    }
    if (input.version !== IDENTITY_STORE_VERSION) {
      throw new IdentityStateError(
        'IDENTITY_STATE_VERSION_UNSUPPORTED',
        path,
        `Identity state at ${path} uses unsupported version ${input.version}`,
      )
    }
    try {
      const { version: _, ...store } = IdentityFileV1Schema.parse(input)
      return { store }
    } catch (error) {
      throw invalidState(path, error)
    }
  }

  try {
    return { store: IdentityStoreSchema.parse(input), legacyBytes: raw }
  } catch (error) {
    throw invalidState(path, error)
  }
}

function hasVersion(input: unknown): input is { readonly version: unknown } {
  return typeof input === 'object' && input !== null && Object.hasOwn(input, 'version')
}

function seed(now: Date): IdentityStore {
  return {
    default: 'manager',
    identities: {
      manager: {
        subject: 'manager',
        createdAt: now.toISOString(),
        source: 'key',
        mode: 'local',
      },
    },
  }
}

function encodeV1(store: IdentityStore): string {
  return `${JSON.stringify({ version: IDENTITY_STORE_VERSION, ...store }, null, 2)}\n`
}

async function preserveLegacyBackup(path: string, legacyBytes: string): Promise<void> {
  const backupPath = `${path}.v0.bak`
  try {
    const existing = await readFile(backupPath, 'utf-8')
    if (existing !== legacyBytes) {
      throw new IdentityStateError(
        'IDENTITY_STATE_BACKUP_CONFLICT',
        backupPath,
        `Legacy identity backup at ${backupPath} does not match the file being migrated`,
      )
    }
  } catch (error) {
    if (error instanceof IdentityStateError) throw error
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw new IdentityStateError(
        'IDENTITY_STATE_UNREADABLE',
        backupPath,
        `Could not read legacy identity backup at ${backupPath}`,
        error,
      )
    }
    await atomicWrite(backupPath, legacyBytes)
  }
}

function invalidState(path: string, cause?: unknown): IdentityStateError {
  return new IdentityStateError(
    'IDENTITY_STATE_INVALID',
    path,
    `Identity state at ${path} is malformed`,
    cause,
  )
}
