import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_IDENTITY_REGISTRY_TRANSITIONS = defineLaw({
  id: 'CLI-IDENTITY-REGISTRY-TRANSITIONS',
  statement:
    'Create, selection, registration, mode change, and non-default deletion preserve one locked registry and isolated subject keypair; deleting the selected identity is rejected unchanged.',
  tests: [{ file: '__tests__/registry.test.ts', id: 'TEST-CLI-IDENTITY-REGISTRY-JOURNEY' }],
})

export const CLI_IDENTITY_TRANSFER_ADMITTED = defineLaw({
  id: 'CLI-IDENTITY-TRANSFER-ADMITTED',
  statement:
    'Malformed, unsupported-version, or cryptographically mismatched transfer content is rejected before either key files or registry state changes.',
  tests: [{ file: '__tests__/transfer.test.ts', id: 'TEST-CLI-IDENTITY-TRANSFER-REJECTS' }],
})

export const CLI_IDENTITY_TRANSFER_ROUNDTRIP = defineLaw({
  id: 'CLI-IDENTITY-TRANSFER-ROUNDTRIP',
  statement:
    'Legacy plaintext and V1 plaintext or compact-JWE content converge on one V1 envelope, and explicit exports are published atomically with mode 0600.',
  tests: [
    { file: '__tests__/transfer.test.ts', id: 'TEST-CLI-IDENTITY-TRANSFER-ROUNDTRIP' },
    { file: '__tests__/transfer.test.ts', id: 'TEST-CLI-IDENTITY-EXPORT-PRIVATE' },
  ],
})

export const CLI_IDENTITY_IMPORT_ORDERED = defineLaw({
  id: 'CLI-IDENTITY-IMPORT-ORDERED',
  statement:
    'Import checks name and identity-source conflicts under the registry lock before replacing keys, then publishes the registry only after the admitted pair is durable.',
  tests: [{ file: '__tests__/transfer.test.ts', id: 'TEST-CLI-IDENTITY-IMPORT-ORDERED' }],
})
