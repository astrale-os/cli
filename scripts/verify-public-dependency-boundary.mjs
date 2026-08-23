import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const privatePackages = ['@astrale-os/kernel-ports', '@astrale-os/kernel-runtime']
const checkedFiles = [
  'package.json',
  'studio/package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
]

for (const path of checkedFiles) {
  const contents = await readFile(path, 'utf8')
  for (const privatePackage of privatePackages) {
    assert.equal(
      contents.includes(privatePackage),
      false,
      `${path} exposes the private package ${privatePackage}`,
    )
  }
}

for (const path of ['package.json', 'studio/package.json']) {
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith('@astrale-os/')) continue
      assert.doesNotMatch(
        specifier,
        /^(?:file|link|workspace):/,
        `${path} ${field}.${name} must resolve through an ordinary package version`,
      )
    }
  }
}

for (const path of ['pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
  const contents = await readFile(path, 'utf8')
  assert.equal(contents.includes('.cohort'), false, `${path} contains exact-source topology`)
  assert.equal(
    /vendor\/astrale-os-(?:sdk|shell)-[^\s]+\.tgz/.test(contents),
    false,
    `${path} resolves a vendored Astrale package archive`,
  )
}

console.log('verified CLI public dependency closure excludes private Kernel packages')
