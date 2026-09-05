import type { OperationId } from '@astrale-os/sdk/client/schema'

import { AstraleError } from '../../errors'

const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export function acceptDomainOperationId(
  input: unknown,
  intent: 'install' | 'uninstall',
): OperationId {
  if (typeof input !== 'string' || !OPERATION_ID_PATTERN.test(input)) {
    throw new AstraleError(
      'INVALID_FLAG',
      '--operation must be a canonical lowercase UUIDv4.',
      `Omit --operation for a fresh ${intent}; use it only with the exact UUID printed for recovery.`,
    )
  }
  return input as OperationId
}

export function createDomainOperationId(intent: 'install' | 'uninstall'): OperationId {
  return acceptDomainOperationId(globalThis.crypto.randomUUID(), intent)
}
