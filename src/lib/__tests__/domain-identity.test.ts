/**
 * Adversarial: `collectFunctionSubs` originally hard-coded `class.` as the
 * only accepted member-namespace prefix, silently dropping every
 * `method_of` edge whose target was `interface.<X>`. Installing a domain
 * with any static method on a `nodeInterface` then failed at the kernel
 * with `subs missing function path "/:<origin>:interface.<X>:<method>"` —
 * an officially documented authoring pattern was unusable.
 *
 * These tests pin both buckets (class + interface) and both edge-target
 * spellings (tree-form `/origin/Member/self` + typed-form `/:origin:Member`)
 * because both shapes can appear in the wild — the legacy spec builder
 * emitted the tree form and the current one emits the typed form.
 */

import { describe, expect, test } from 'bun:test'

import { AstraleError } from '../../errors'
import { collectFunctionSubs, inferAlg } from '../domain-identity'

const ORIGIN = 'notes.localhost'
const METHOD_OF = '/:kernel.astrale.ai:class.method_of'

type Spec = Parameters<typeof collectFunctionSubs>[0]

function spec(edges: Spec['edges']): Spec {
  return { nodes: [], edges }
}

describe('collectFunctionSubs', () => {
  test('emits sub for class-hosted method (typed-form target)', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: `/${ORIGIN}/class.Note/createNote`,
          target: `/:${ORIGIN}:class.Note`,
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([`/:${ORIGIN}:class.Note:createNote`])
  })

  // META_TRACE #44 — DSL builder (sdkCommit db7c97d) emits typed-form
  // sources like `/:origin:class.Member:method`. The CLI used to only
  // accept tree-form sources, silently producing empty `subs` claims and
  // failing every install with "subs missing function path …".
  test('emits sub for class-hosted method (typed-form source)', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: `/:${ORIGIN}:class.Note:createNote`,
          target: `/:${ORIGIN}:class.Note`,
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([`/:${ORIGIN}:class.Note:createNote`])
  })

  test('emits sub for interface-hosted method (typed-form source)', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: `/:${ORIGIN}:interface.NoteOps:ensureRoot`,
          target: `/:${ORIGIN}:interface.NoteOps`,
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([`/:${ORIGIN}:interface.NoteOps:ensureRoot`])
  })

  test('handles a real-builder spec — typed-form on both source and target', () => {
    // Pin what `astrale domain build --preset local:inprocess` actually
    // emits today. A future flip back to tree-form would silently break
    // the install path otherwise.
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: `/:${ORIGIN}:class.Note:ensureRoot`,
          target: `/:${ORIGIN}:class.Note`,
        },
        {
          class: METHOD_OF,
          source: `/:${ORIGIN}:class.Note:createNote`,
          target: `/:${ORIGIN}:class.Note`,
        },
        {
          class: METHOD_OF,
          source: `/:${ORIGIN}:class.Note:listNotes`,
          target: `/:${ORIGIN}:class.Note`,
        },
      ]),
      ORIGIN,
    )
    expect(out.sort()).toEqual([
      `/:${ORIGIN}:class.Note:createNote`,
      `/:${ORIGIN}:class.Note:ensureRoot`,
      `/:${ORIGIN}:class.Note:listNotes`,
    ])
  })

  test('rejects malformed typed-form source with empty method', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: `/:${ORIGIN}:class.Note:`,
          target: `/:${ORIGIN}:class.Note`,
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([])
  })

  test('rejects typed-form source from a different origin', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: '/:other.origin:class.Note:createNote',
          target: '/:other.origin:class.Note',
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([])
  })

  test('emits sub for class-hosted method (tree-form target with /self)', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: `/${ORIGIN}/class.Note/createNote`,
          target: `/${ORIGIN}/class.Note/self`,
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([`/:${ORIGIN}:class.Note:createNote`])
  })

  test('emits sub for interface-hosted method (typed-form target)', () => {
    // Regression: this was the case the kernel rejected.
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: `/${ORIGIN}/interface.NoteOps/ensureRoot`,
          target: `/:${ORIGIN}:interface.NoteOps`,
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([`/:${ORIGIN}:interface.NoteOps:ensureRoot`])
  })

  test('emits sub for interface-hosted method (tree-form target with /self)', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: `/${ORIGIN}/interface.NoteOps/ensureRoot`,
          target: `/${ORIGIN}/interface.NoteOps/self`,
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([`/:${ORIGIN}:interface.NoteOps:ensureRoot`])
  })

  test('emits subs for both class and interface methods in the same spec', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: `/${ORIGIN}/class.Note/createNote`,
          target: `/:${ORIGIN}:class.Note`,
        },
        {
          class: METHOD_OF,
          source: `/${ORIGIN}/interface.NoteOps/ensureRoot`,
          target: `/:${ORIGIN}:interface.NoteOps`,
        },
      ]),
      ORIGIN,
    )
    expect(out.sort()).toEqual([
      `/:${ORIGIN}:class.Note:createNote`,
      `/:${ORIGIN}:interface.NoteOps:ensureRoot`,
    ])
  })

  test('accepts the /self-suffixed method_of class form', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: `${METHOD_OF}/self`,
          source: `/${ORIGIN}/interface.NoteOps/ensureRoot`,
          target: `/:${ORIGIN}:interface.NoteOps`,
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([`/:${ORIGIN}:interface.NoteOps:ensureRoot`])
  })

  test('skips edges with non-method_of class', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: '/:kernel.astrale.ai:class.has_parent',
          source: `/${ORIGIN}/class.Note/createNote`,
          target: `/:${ORIGIN}:class.Note`,
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([])
  })

  test('skips method_of edges whose member is neither class.* nor interface.*', () => {
    // Hardens the allowlist — a stray method_of pointing at a non-Member
    // typed path (e.g. a Domain) must not produce a sub.
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: `/${ORIGIN}/syscall.something/run`,
          target: `/:${ORIGIN}:syscall.something`,
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([])
  })

  test('skips edges whose source is from a different origin', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: METHOD_OF,
          source: '/other.origin/class.Note/createNote',
          target: '/:other.origin:class.Note',
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([])
  })

  test('deduplicates subs (same edge appearing twice)', () => {
    const dup = {
      class: METHOD_OF,
      source: `/${ORIGIN}/interface.NoteOps/ensureRoot`,
      target: `/:${ORIGIN}:interface.NoteOps`,
    }
    const out = collectFunctionSubs(spec([dup, dup]), ORIGIN)
    expect(out).toEqual([`/:${ORIGIN}:interface.NoteOps:ensureRoot`])
  })

  test('accepts the {raw} object form for class/source/target', () => {
    const out = collectFunctionSubs(
      spec([
        {
          class: { raw: METHOD_OF },
          source: { raw: `/${ORIGIN}/interface.NoteOps/ensureRoot` },
          target: { raw: `/:${ORIGIN}:interface.NoteOps` },
        },
      ]),
      ORIGIN,
    )
    expect(out).toEqual([`/:${ORIGIN}:interface.NoteOps:ensureRoot`])
  })
})

describe('inferAlg', () => {
  // Adversarial: `astrale init` historically generated ES256 keys without
  // stamping `alg`. Every fresh-machine `astrale instance install` then
  // crashed with "alg is required when jwk.alg is not present" because the
  // CLI read `privateJwk.alg as string` directly and handed `undefined` to
  // jose's importJWK. The fix sets `alg` at keygen time AND falls back to
  // inferring from `crv`/`kty` for already-issued keys (META_TRACE #34).

  test('returns explicit alg when present', () => {
    expect(inferAlg({ alg: 'ES256' })).toBe('ES256')
    expect(inferAlg({ alg: 'EdDSA' })).toBe('EdDSA')
  })

  test('infers ES256 from P-256 EC keys (crv + kty) when alg is missing', () => {
    expect(inferAlg({ kty: 'EC', crv: 'P-256' })).toBe('ES256')
  })

  test('infers EdDSA from Ed25519 OKP keys (crv + kty) when alg is missing', () => {
    expect(inferAlg({ kty: 'OKP', crv: 'Ed25519' })).toBe('EdDSA')
  })

  test('explicit alg wins over inferable shape (no second-guessing)', () => {
    // If a file says ES256 but has Ed25519 components, that's a broken
    // file — don't silently override. assertKeyPairConsistent will catch
    // the mismatch downstream.
    expect(inferAlg({ alg: 'ES256', kty: 'OKP', crv: 'Ed25519' })).toBe('ES256')
  })

  test('throws AstraleError with hint when no alg/crv/kty resolves', () => {
    expect(() => inferAlg({})).toThrow(AstraleError)
    expect(() => inferAlg({ kty: 'EC' })).toThrow(AstraleError)
    expect(() => inferAlg({ kty: 'EC', crv: 'P-384' })).toThrow(AstraleError)
  })

  test('error message includes keyPath when provided', () => {
    expect(() => inferAlg({}, '/path/to/broken.jwk')).toThrow(/\/path\/to\/broken\.jwk/)
  })

  test('treats empty-string alg as missing', () => {
    expect(inferAlg({ alg: '', kty: 'EC', crv: 'P-256' })).toBe('ES256')
  })
})
