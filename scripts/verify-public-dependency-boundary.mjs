import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

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

const vendored = await readdir('vendor', { recursive: true })
for (const privatePackage of privatePackages) {
  const packageName = privatePackage.slice('@astrale-os/'.length)
  assert.equal(
    vendored.some((name) => name.includes(packageName)),
    false,
    `vendor contains the private package ${privatePackage}`,
  )
}

console.log('verified CLI public dependency closure excludes private Kernel packages')
