import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readEnvModel } from './files'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('env editor composes typed fields with isolated config and dotenv previews', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-env-preview-'))
  roots.push(root)
  writeFileSync(
    join(root, 'env.ts'),
    `export interface Env {
  /** API credential. */
  API_TOKEN: string
  OPTIONAL_NOTE?: string
  WORKER_URL: string
}`,
  )
  writeFileSync(
    join(root, 'astrale.config.ts'),
    `// astrale({ dev: { secrets: '.env.fake' } })
export default cloudflare({ dev: { secrets: '.env.dev' } })`,
  )
  writeFileSync(join(root, '.env.dev'), `BASE=token\nAPI_TOKEN="${'${BASE}'}-value"\nORPHAN=kept\n`)

  expect(readEnvModel(root, 'dev')).toEqual({
    env: 'dev',
    file: '.env.dev',
    configured: true,
    exists: true,
    adapter: 'cloudflare',
    requiredMissing: 0,
    rows: [
      {
        name: 'API_TOKEN',
        value: 'token-value',
        declared: true,
        optional: false,
        doc: 'API credential.',
      },
      { name: 'OPTIONAL_NOTE', value: '', declared: true, optional: true },
      { name: 'BASE', value: 'token', declared: false, optional: true },
      { name: 'ORPHAN', value: 'kept', declared: false, optional: true },
    ],
  })
})
