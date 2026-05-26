import { describe, expect, test } from 'bun:test'

import { isOurWorker, type ProcIdentity } from '../worker-reaper'

// Fake (non-existent) paths: realpathSafe returns null for these, so
// isOurWorker falls back to literal string comparison — exactly the seam
// we want to pin without spawning real processes.
const WORKER = '/fake/domains/integration/worker'

function id(partial: Partial<ProcIdentity>): ProcIdentity {
  return { pid: 123, comm: 'workerd', cwd: WORKER, argv: [], ...partial }
}

describe('isOurWorker', () => {
  test('workerd whose cwd is the worker dir → ours', () => {
    expect(isOurWorker(id({ comm: 'workerd', cwd: WORKER }), WORKER)).toBe(true)
  })

  test('node wrangler dev launcher whose cwd is the worker dir → ours', () => {
    expect(
      isOurWorker(
        id({
          comm: 'node',
          cwd: WORKER,
          argv: ['node', '/x/node_modules/.bin/wrangler', 'dev', '--port', '8899'],
        }),
        WORKER,
      ),
    ).toBe(true)
  })

  test('vite is never ours (HMR dev server)', () => {
    expect(
      isOurWorker(id({ comm: 'vite', cwd: `${WORKER}/client`, argv: ['node', 'vite'] }), WORKER),
    ).toBe(false)
  })

  test('esbuild is never ours (bundler child self-exits with its parent)', () => {
    expect(isOurWorker(id({ comm: 'esbuild', cwd: WORKER }), WORKER)).toBe(false)
  })

  test("another domain's workerd (different cwd) → foreign", () => {
    expect(isOurWorker(id({ comm: 'workerd', cwd: '/fake/domains/notes/worker' }), WORKER)).toBe(
      false,
    )
  })

  test('wrangler dev but rooted in the client dir → not ours (cwd mismatch)', () => {
    expect(
      isOurWorker(
        id({ comm: 'node', cwd: `${WORKER}/client`, argv: ['node', 'wrangler', 'dev'] }),
        WORKER,
      ),
    ).toBe(false)
  })

  test('node without a wrangler+dev argv → not ours', () => {
    expect(
      isOurWorker(id({ comm: 'node', cwd: WORKER, argv: ['node', 'something', 'else'] }), WORKER),
    ).toBe(false)
  })

  test('node with wrangler but no dev subcommand → not ours', () => {
    expect(
      isOurWorker(id({ comm: 'node', cwd: WORKER, argv: ['node', 'wrangler', 'deploy'] }), WORKER),
    ).toBe(false)
  })
})
