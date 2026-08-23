import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { exactSourceWorkspace } from '../workspace.mjs'

const root = new URL('../../../', import.meta.url)
const workspace = readFileSync(new URL('pnpm-workspace.yaml', root), 'utf8')

describe('exact source workspace', () => {
  it('admits the closed workspace membership', () => {
    assert.equal(exactSourceWorkspace(workspace).length, 7)
  })

  it('rejects expanded, duplicate, aliased, or negated membership', () => {
    for (const member of ['.cohort/extra', '.cohort/sdk', './.cohort/sdk', '!.cohort/sdk']) {
      assert.throws(
        () =>
          exactSourceWorkspace(
            workspace.replace("  - '.cohort/sdk'", `  - '.cohort/sdk'\n  - '${member}'`),
          ),
        /Exact source configuration/u,
      )
    }
  })
})
