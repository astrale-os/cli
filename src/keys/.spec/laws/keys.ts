import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_KEYS_IDENTITY_ISOLATED = defineLaw({
  id: 'CLI-KEYS-IDENTITY-ISOLATED',
  statement:
    'Each subject signs only with its own mode-0600 keypair; missing subject material fails even when manager keys exist.',
  tests: [
    { file: '__tests__/keys.test.ts', id: 'TEST-CLI-KEYS-PRIVATE-MODE' },
    { file: '__tests__/keys.test.ts', id: 'TEST-CLI-KEYS-NO-MANAGER-FALLBACK' },
  ],
})

export const CLI_KEYS_LEGACY_READABLE = defineLaw({
  id: 'CLI-KEYS-LEGACY-READABLE',
  statement:
    'Manager filenames and unstamped supported legacy algorithms remain readable without changing another identity key coordinate.',
  tests: [
    { file: '__tests__/keys.test.ts', id: 'TEST-CLI-KEYS-LEGACY-FILENAMES' },
    { file: '__tests__/algorithm.test.ts', id: 'TEST-CLI-KEYS-INFERS-LEGACY-ALGORITHM' },
  ],
})

export const CLI_KEYS_PAIR_ADMITTED = defineLaw({
  id: 'CLI-KEYS-PAIR-ADMITTED',
  statement:
    'A subject path remains inside the selected key directory, and imported or persisted material is returned only after supported-algorithm and private/public correspondence proof.',
  tests: [
    { file: '__tests__/keys.test.ts', id: 'TEST-CLI-KEYS-PAIR-ADMISSION' },
    { file: '__tests__/keys.test.ts', id: 'TEST-CLI-KEYS-PATH-CONFINED' },
  ],
})

export const CLI_KEYS_CREDENTIAL_GRANT_PROFILE = defineLaw({
  id: 'CLI-KEYS-CREDENTIAL-GRANT-PROFILE',
  statement:
    'A self-issued Kernel credential carries the effective subject as an already-resolved identity Grant, while an externally issued primary credential carries an identity-self Grant for Runtime resolution.',
  tests: [
    {
      file: '__tests__/keys.test.ts',
      id: 'TEST-CLI-KEYS-DISTINGUISHES-KERNEL-ROOT-GRANT',
    },
  ],
})
