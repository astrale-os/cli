import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

const privatePackage = '@astrale-os/kernel-ports'
const checkedFiles = [
  'package.json',
  'studio/package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
]

for (const path of checkedFiles) {
  const contents = await readFile(path, 'utf8')
  assert.equal(
    contents.includes(privatePackage),
    false,
    `${path} exposes the private Kernel Ports package`,
  )
}

const vendored = [...(await readdir('vendor')), ...(await readdir('vendor/kernel'))]
assert.equal(
  vendored.some((name) => name.includes('kernel-ports')),
  false,
  'vendor contains the private Kernel Ports package',
)

console.log('verified CLI public dependency closure excludes Kernel Ports')
