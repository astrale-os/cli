import assert from 'node:assert/strict'

const expected = {
  '@astrale-os/cli/connect-core': [
    'readIdentities',
    'readInstances',
    'resetInstancesMemo',
    'resolveCredential',
    'loginViaIdp',
    'fetchWithCaFile',
  ],
  '@astrale-os/cli/keys': ['listIdentityKeys', 'readKeypair', 'signAs'],
  '@astrale-os/cli/paths': ['ASTRALE_HOME', 'createPaths'],
}

for (const [specifier, names] of Object.entries(expected)) {
  const module = await import(specifier)
  for (const name of names) {
    assert.ok(name in module, `${specifier} is missing ${name}`)
  }
}

console.log('verified Node-loadable CLI public subpaths')
