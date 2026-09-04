import { describe, expect, mock, test } from 'bun:test'

import type { ConnectionContext } from '../../connection'

import { ensureHostInstance, hostCall, readHostInstance } from '../instance'

const ready = {
  instance: '@child',
  slug: 'development',
  issuer: 'https://kernel.example.test/kernel/development',
  desired: { state: 'running', generation: 1 },
  observed: { state: 'ready', generation: 1 },
  route: { state: 'published', url: 'https://kernel.example.test/kernel/development' },
} as const

function fixture(values: unknown[] = [ready], retained = true) {
  const dispatch = mock(async () => ({ kind: 'value', value: values.shift() }))
  const query = mock(async () => ({
    result: {
      kind: 'graph',
      graph: {
        nodes: retained
          ? [
              {
                id: 'child',
                props: { 'host.astrale.ai:class.Instance.property.slug': 'development' },
              },
            ]
          : [],
        edges: [],
      },
    },
    page: {},
  }))
  const context = {
    target: { kernelIssuer: 'https://kernel.example.test/kernel/host' },
    session: { dispatch },
    graph: { query },
  } as unknown as ConnectionContext
  return { context, dispatch, query }
}

describe('direct Kernel Host child provisioning', () => {
  test('reconnects an existing ready child without issuing another create', async () => {
    const { context, dispatch } = fixture()
    expect(await ensureHostInstance(context, 'development')).toEqual(ready)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  test('creates a missing child and admits only its exact ready status', async () => {
    const { context, dispatch } = fixture([{ instance: '@child' }, ready], false)
    expect(await ensureHostInstance(context, 'development')).toEqual(ready)
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(dispatch.mock.calls[0])).toContain(ready.issuer)
  })

  test.each([
    { ...ready, instance: '@another-child' },
    { ...ready, issuer: 'https://other.example.test/kernel/development' },
    { ...ready, slug: 'other' },
  ])('rejects mismatched child coordinates', async (status) => {
    const { context } = fixture([status])
    await expect(ensureHostInstance(context, 'development')).rejects.toMatchObject({
      code: 'HOST_INSTANCE_MISMATCH',
    })
  })

  test('does not restart an intentionally stopped child', async () => {
    const { context, dispatch } = fixture([
      { ...ready, desired: { state: 'stopped', generation: 2 } },
    ])
    await expect(ensureHostInstance(context, 'development')).rejects.toMatchObject({
      code: 'HOST_INSTANCE_NOT_READY',
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  test('rejects non-manager targets before graph reads or mutations', async () => {
    const { context, dispatch, query } = fixture()
    const invalid = {
      ...context,
      target: { ...context.target, kernelIssuer: ready.issuer },
    } as ConnectionContext
    await expect(ensureHostInstance(invalid, 'development')).rejects.toMatchObject({
      code: 'HOST_TARGET_INVALID',
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  test('rejects malformed status and non-value envelopes', async () => {
    const { context } = fixture([{ ...ready, desired: { state: 'unknown', generation: 1 } }])
    await expect(readHostInstance(context, '@child')).rejects.toThrow()
    const invalid = {
      ...context,
      session: { dispatch: async () => ({ kind: 'stream' }) },
    } as unknown as ConnectionContext
    await expect(hostCall(invalid, '@child::status', {})).rejects.toMatchObject({
      code: 'HOST_RESPONSE_INVALID',
    })
  })
})
