import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { exactReleaseSecret } from '../release.mjs'

const root = new URL('../../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const release = read('.github/workflows/release.yml')
const binary = read('.github/workflows/cli-release.yml')
const token = '${{ secrets.COHORT_REPOSITORY_TOKEN }}'

describe('exact release secret', () => {
  it('admits one narrow reusable-workflow secret', () => {
    assert.equal(exactReleaseSecret(release, binary), 'COHORT_REPOSITORY_TOKEN')
  })

  it('rejects broad, missing, or optional reusable secrets', () => {
    for (const [caller, callee] of [
      [release.replace(/    secrets:\n(?:      .+\n)+/u, '    secrets: inherit\n'), binary],
      [release, binary.replace('required: true', 'required: false')],
      [release.replace(token, '${{ secrets.OTHER_TOKEN }}'), binary],
    ]) {
      assert.throws(() => exactReleaseSecret(caller, callee), /Exact source configuration/u)
    }
  })
})
