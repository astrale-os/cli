import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invalidateClientPackage, resolveClientPackage } from './client-package'

const roots: string[] = []

function fixture(options: { dir?: string; capability?: boolean; countImports?: boolean } = {}): {
  root: string
  clientDir: string
  counter: string
} {
  const root = mkdtempSync(join(tmpdir(), 'studio-client-package-'))
  const dir = options.dir ?? 'frontend'
  const clientDir = join(root, dir)
  const counter = join(root, 'imports.txt')
  roots.push(root)
  mkdirSync(clientDir, { recursive: true })
  writeFileSync(
    join(clientDir, 'package.json'),
    JSON.stringify({ private: true, scripts: { 'dev:hmr': 'vite' } }),
  )
  writeFileSync(
    join(root, 'astrale.config.ts'),
    `${options.countImports ? `import { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(counter)}, 'x')\nconsole.log('fixture config output')\n` : ''}
const adapter = {
  name: 'fixture',
  params: (_env: string) => ({ dir: ${JSON.stringify(dir)} }),
  ${options.capability === false ? '' : `clientPackage: (params: { dir: string }, ctx: { projectDir: string }) => ({ dir: ctx.projectDir + '/' + params.dir }),`}
}
export default { adapter }
`,
  )
  return { root, clientDir, counter }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    invalidateClientPackage(root)
    rmSync(root, { recursive: true, force: true })
  }
})

describe('client package discovery', () => {
  test('uses the adapter capability and caches isolated config imports', async () => {
    const { root, clientDir, counter } = fixture({ countImports: true })

    const first = await resolveClientPackage(root)
    const second = await resolveClientPackage(root)

    expect(first).toMatchObject({ status: 'available', dir: clientDir, source: 'adapter' })
    expect(second).toEqual(first)
    expect(readFileSync(counter, 'utf8')).toBe('x')
  })

  test('keeps client as the compatibility convention for older adapters', async () => {
    const { root, clientDir } = fixture({ dir: 'client', capability: false })

    expect(await resolveClientPackage(root)).toMatchObject({
      status: 'available',
      dir: clientDir,
      source: 'convention',
    })
  })

  test('keeps package discovery separate from preview-script validation', async () => {
    const { root, clientDir } = fixture()
    writeFileSync(join(clientDir, 'package.json'), JSON.stringify({ private: true }))

    const client = await resolveClientPackage(root)
    expect(client).toMatchObject({
      status: 'available',
      dir: clientDir,
    })
    if (client.status === 'available') expect(client.devScript).toBeUndefined()
  })
})
