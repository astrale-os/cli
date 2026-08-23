import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { exactInstalledSources } from '../installation.mjs'

const expected = Object.freeze({
  kernel: '/sources/kernel',
  sdk: '/sources/sdk',
  shell: '/sources/shell',
})
const actual = Object.freeze({
  packages: Object.freeze({
    kernel: Object.freeze({ 'kernel-client': expected.kernel, 'kernel-core': expected.kernel }),
    sdk: Object.freeze({ sdk: expected.sdk }),
    shell: Object.freeze({ shell: expected.shell }),
  }),
  sdkKernel: expected.kernel,
})

describe('exact installed sources', () => {
  it('admits one physical root per source', () => {
    assert.deepEqual(exactInstalledSources(actual, expected), expected)
  })

  it('rejects a same-revision package or SDK link from another clone', () => {
    assert.throws(
      () =>
        exactInstalledSources(
          {
            ...actual,
            packages: {
              ...actual.packages,
              kernel: { ...actual.packages.kernel, 'kernel-core': '/other/kernel' },
            },
          },
          expected,
        ),
      /another physical root/u,
    )
    assert.throws(
      () => exactInstalledSources({ ...actual, sdkKernel: '/other/kernel' }, expected),
      /another physical root/u,
    )
  })
})
