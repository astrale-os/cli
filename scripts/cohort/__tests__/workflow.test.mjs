import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { exactSourceWorkflow } from '../workflow.mjs'

const root = new URL('../../../', import.meta.url)
const ci = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8')
const jobs = ['compatibility', 'studio-browser']
const token = '${{ secrets.COHORT_REPOSITORY_TOKEN }}'

describe('exact source workflow', () => {
  it('admits the named jobs as thin action callers', () => {
    assert.deepEqual(exactSourceWorkflow(ci, jobs, token), jobs)
  })

  it('rejects missing, duplicate, credential-drifted, and direct ownership', () => {
    for (const mutated of [
      ci.replace('./.github/actions/exact-sources', './other'),
      ci.replace(
        '      - uses: oven-sh/setup-bun@v2',
        '      - uses: ./.github/actions/exact-sources\n        with:\n          repository-token: ${{ secrets.COHORT_REPOSITORY_TOKEN }}\n      - uses: oven-sh/setup-bun@v2',
      ),
      ci.replace('jobs:\n  compatibility:', 'jobs:\n  removed:'),
      ci.replace(token, '${{ secrets.OTHER_TOKEN }}'),
      ci.replace(
        '      - name: Prepare exact sources',
        '      - uses: actions/checkout@v4\n        with:\n          repository: astrale-os/sdk\n      - name: Prepare exact sources',
      ),
    ]) {
      assert.throws(() => exactSourceWorkflow(mutated, jobs, token), /Exact source configuration/u)
    }
  })
})
