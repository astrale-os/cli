import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const expected = {
  '@astrale-os/cli/connect-core': [
    'readIdentities',
    'readInstances',
    'resetInstancesMemo',
    'resolveCredential',
    'withAdminClientSession',
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

const publicKernelTypeImports = []
for (const path of (await readdir('dist/types', { recursive: true })).filter((path) =>
  path.endsWith('.d.ts'),
)) {
  const contents = await readFile(`dist/types/${path}`, 'utf8')
  if (/(?:\bfrom\s*|\bimport\s*\(\s*)['"]@astrale-os\/kernel-/u.test(contents)) {
    publicKernelTypeImports.push(path)
  }
}
assert.deepEqual(
  publicKernelTypeImports,
  [],
  'CLI public declarations must expose connection types through the SDK facade',
)

console.log('verified Node-loadable CLI public subpaths')
