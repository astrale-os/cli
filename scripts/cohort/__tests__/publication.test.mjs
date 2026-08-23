import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { exactPublicationInstall } from '../publication.mjs'

const root = new URL('../../../', import.meta.url)
const publish = readFileSync(new URL('.github/workflows/publish.yml', root), 'utf8')
const exact = 'pnpm install --frozen-lockfile --ignore-scripts && pnpm check:cohort'
const install = 'pnpm install --frozen-lockfile --ignore-scripts'

describe('exact publication install', () => {
  it('admits verification immediately after the frozen install', () => {
    assert.equal(exactPublicationInstall(publish), true)
  })

  it('rejects missing, displaced, reordered, or non-failing verification', () => {
    for (const mutated of [
      publish.replace(exact, install),
      publish.replace(exact, `pnpm check:cohort && ${install}`),
      publish.replace(exact, `${exact} || true`),
      `${publish.replace(exact, install)}\n# pnpm check:cohort\n`,
    ]) {
      assert.throws(() => exactPublicationInstall(mutated), /Exact source configuration/u)
    }
  })
})
