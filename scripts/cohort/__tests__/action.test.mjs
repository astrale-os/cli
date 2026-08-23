import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { exactSourceAction } from '../action.mjs'

const root = new URL('../../../', import.meta.url)
const action = readFileSync(new URL('.github/actions/exact-sources/action.yml', root), 'utf8')
const revisions = exactSourceAction(action)

describe('exact source action', () => {
  it('owns the exact Kernel, SDK, and Shell revisions', () => {
    assert.deepEqual(Object.keys(revisions), ['kernel', 'sdk', 'shell'])
  })

  for (const [name, mutation] of [
    ['abbreviated revision', (value) => value.replace(revisions.sdk, revisions.sdk.slice(0, -1))],
    [
      'wrong repository',
      (value) => value.replace('repository: astrale-os/sdk', 'repository: astrale-os/other'),
    ],
    ['wrong path', (value) => value.replace('path: .cohort/sdk', 'path: .cohort/other')],
    [
      'wrong checkout token',
      (value) =>
        value.replace(
          'token: ${{ inputs.repository-token }}',
          'token: ${{ secrets.COHORT_REPOSITORY_TOKEN }}',
        ),
    ],
    [
      'persisted credential',
      (value) => value.replace('persist-credentials: false', 'persist-credentials: true'),
    ],
    ['optional token', (value) => value.replace('required: true', 'required: false')],
    [
      'missing source binding',
      (value) => value.replace('ln -s ../../kernel', 'ln -s ../../../kernel'),
    ],
  ]) {
    it(`rejects a ${name}`, () => {
      assert.throws(() => exactSourceAction(mutation(action)), /Exact source configuration/u)
    })
  }
})
