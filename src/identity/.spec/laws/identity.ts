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

export const CLI_IDENTITY_TRANSFER_SCHEMA = defineLaw({
  id: 'CLI-IDENTITY-TRANSFER-SCHEMA',
  statement:
    'Plaintext IdentityExport V1 has one independently versioned portable JSON Schema; decoding additionally proves the JWK pair before any durable mutation.',
  tests: [
    {
      file: '__tests__/transfer.test.ts',
      id: 'TEST-CLI-IDENTITY-TRANSFER-SCHEMA',
    },
  ],
})

export const CLI_IDENTITY_IMPORT_ORDERED = defineLaw({
  id: 'CLI-IDENTITY-IMPORT-ORDERED',
  statement:
    'Import checks name and identity-source conflicts under the registry lock before replacing keys, then publishes the registry only after the admitted pair is durable.',
  tests: [{ file: '__tests__/transfer.test.ts', id: 'TEST-CLI-IDENTITY-IMPORT-ORDERED' }],
})

export const CLI_IDENTITY_REGISTRATION_AUTHORITY = defineLaw({
  id: 'CLI-IDENTITY-REGISTRATION-AUTHORITY',
  statement:
    'Identity registration binds one self-proven Provision request to the selected Kernel; direct submission uses caller authority, while explicit Domain-mediated submission sends the same request to the named callable and persists only its admitted prepared binding.',
  tests: [
    {
      file: '__tests__/registration.test.ts',
      id: 'TEST-CLI-IDENTITY-REGISTER-DOMAIN-MEDIATED',
    },
  ],
})

export const CLI_IDENTITY_LOOKUP_EXPECTED_FAILURE = defineLaw({
  id: 'CLI-IDENTITY-LOOKUP-EXPECTED-FAILURE',
  statement:
    'A named local Identity lookup that is absent returns the stable IDENTITY_NOT_FOUND family and an exact identity-create correction instead of an unexpected internal failure.',
  tests: [{ file: '__tests__/registry.test.ts', id: 'TEST-CLI-IDENTITY-REGISTRY-JOURNEY' }],
})
