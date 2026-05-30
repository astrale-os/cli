import type { LifecycleConfig } from '@astrale-os/kernel-host'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type DomainInput, type Finding, checkDomain, hasError } from '../env-check'

/**
 * Each check in `astrale env check` is exercised against a tiny temp-dir
 * domain fixture: a directory with whatever files the check reads
 * (`.env.example`, `schema/*.ts`, `worker/wrangler.jsonc`) plus an
 * in-memory `LifecycleConfig` (no real `lifecycle.ts` needed).
 */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'env-check-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function input(config: LifecycleConfig): DomainInput {
  return { dir, slug: 'fixture', config }
}

function writeFile(rel: string, content: string): void {
  const path = join(dir, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

/** Find findings by check id. */
function find(findings: readonly Finding[], check: string): Finding[] {
  return findings.filter((f) => f.check === check)
}

describe('(a) .env.example completeness', () => {
  test('missing required key → error listing it', async () => {
    writeFile('.env.example', '# nothing here\n')
    const report = await checkDomain(input({ requiredSecrets: ['FOO_KEY'] }))
    const f = find(report.findings, 'env-example')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('error')
    expect(f[0].message).toContain('FOO_KEY')
    expect(hasError(report)).toBe(true)
  })

  test('union of requiredSecrets ∪ forwardEnv; forwardEnvOptional excluded', async () => {
    writeFile('.env.example', 'PRESENT=\n')
    const report = await checkDomain(
      input({
        requiredSecrets: ['PRESENT'],
        forwardEnv: ['MISSING_FWD'],
        forwardEnvOptional: ['OPTIONAL_IGNORED'],
      }),
    )
    const f = find(report.findings, 'env-example')
    expect(f).toHaveLength(1)
    expect(f[0].message).toContain('MISSING_FWD')
    expect(f[0].message).not.toContain('OPTIONAL_IGNORED')
    expect(f[0].message).not.toContain('PRESENT')
  })

  test('all keys present → no finding', async () => {
    writeFile('.env.example', 'FOO_KEY=\nBAR_KEY=value\n')
    const report = await checkDomain(
      input({ requiredSecrets: ['FOO_KEY'], forwardEnv: ['BAR_KEY'] }),
    )
    expect(find(report.findings, 'env-example')).toHaveLength(0)
  })

  test('--fix-example appends missing keys (no clobber) and reports them', async () => {
    writeFile('.env.example', 'EXISTING=already')
    const report = await checkDomain(
      input({ requiredSecrets: ['NEW_ONE'], forwardEnv: ['NEW_TWO'] }),
      { fixExample: true },
    )
    expect(find(report.findings, 'env-example')).toHaveLength(0)
    expect(report.fixed).toEqual(['NEW_ONE', 'NEW_TWO'])
    const text = readFileSync(join(dir, '.env.example'), 'utf-8')
    expect(text).toContain('EXISTING=already') // original preserved
    expect(text).toContain('NEW_ONE=')
    expect(text).toContain('NEW_TWO=')
    expect(text).toContain('(required secret)')
  })

  test('--fix-example creates .env.example when absent', async () => {
    const report = await checkDomain(input({ requiredSecrets: ['CREATED_KEY'] }), {
      fixExample: true,
    })
    expect(report.fixed).toEqual(['CREATED_KEY'])
    expect(readFileSync(join(dir, '.env.example'), 'utf-8')).toContain('CREATED_KEY=')
  })
})

describe('(b) extraDevVars ↔ forward overlap', () => {
  test('overlapping key → error', async () => {
    const report = await checkDomain(input({ extraDevVars: { DUP: 'x' }, forwardEnv: ['DUP'] }))
    const f = find(report.findings, 'devvars-overlap')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('error')
    expect(f[0].message).toContain('DUP')
  })

  test('disjoint maps → no finding', async () => {
    const report = await checkDomain(input({ extraDevVars: { A: 'x' }, forwardEnv: ['B'] }))
    expect(find(report.findings, 'devvars-overlap')).toHaveLength(0)
  })
})

describe('(c) topology leaks', () => {
  test('c1: *_BASE_DOMAIN key in extraDevVars → error', async () => {
    const report = await checkDomain(
      input({ extraDevVars: { FOO_BASE_DOMAIN: 'foo.localhost', OK_VAR: 'x' } }),
    )
    const f = find(report.findings, 'basedomain-literal')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('error')
    expect(f[0].message).toContain('FOO_BASE_DOMAIN')
    expect(f[0].message).not.toContain('OK_VAR')
  })

  test('c2: soft-fallback on *_BASE_DOMAIN in schema → error with file:line', async () => {
    writeFile(
      'schema/schema.ts',
      [
        'const x = 1',
        "const base = process.env.MY_BASE_DOMAIN ?? 'my.astrale.ai'",
        'export const y = 2',
      ].join('\n'),
    )
    const report = await checkDomain(input({}))
    const f = find(report.findings, 'basedomain-fallback')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('error')
    expect(f[0].message).toContain('schema/schema.ts:2')
  })

  test('c2: hard-throw schema (no fallback) → no finding', async () => {
    writeFile(
      'schema/schema.ts',
      [
        'const base = process.env.MY_BASE_DOMAIN',
        'if (!base) throw new Error("MY_BASE_DOMAIN must be set")',
      ].join('\n'),
    )
    const report = await checkDomain(input({}))
    expect(find(report.findings, 'basedomain-fallback')).toHaveLength(0)
  })
})

describe('(d) committed-secret scan', () => {
  test('sk_live_ in wrangler.jsonc → error with file:line', async () => {
    writeFile('worker/wrangler.jsonc', '{\n  "vars": { "K": "sk_live_abc123" }\n}\n')
    const report = await checkDomain(input({}))
    const f = find(report.findings, 'secret-leak')
    expect(
      f.some((x) => x.severity === 'error' && x.message.includes('worker/wrangler.jsonc:2')),
    ).toBe(true)
    expect(hasError(report)).toBe(true)
  })

  test('gho_ and JWK "d": → errors', async () => {
    writeFile('wrangler.toml', 'token = "gho_secrettoken"\n')
    writeFile('.env.example', 'JWK={"kty":"OKP","d":"privatepart"}\n')
    const report = await checkDomain(input({}))
    const f = find(report.findings, 'secret-leak')
    expect(f.filter((x) => x.severity === 'error').length).toBeGreaterThanOrEqual(2)
    expect(f.some((x) => x.message.includes('GitHub OAuth token'))).toBe(true)
    expect(f.some((x) => x.message.includes('JWK private key'))).toBe(true)
  })

  test('sk_test_ → warning, not error', async () => {
    writeFile('worker/wrangler.jsonc', '{ "vars": { "K": "sk_test_abc" } }\n')
    const report = await checkDomain(input({}))
    const f = find(report.findings, 'secret-leak')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('warning')
    expect(hasError(report)).toBe(false)
  })

  test('clean config → no findings at all', async () => {
    writeFile('.env.example', 'FOO_KEY=\n')
    writeFile('worker/wrangler.jsonc', '{ "name": "fixture" }\n')
    writeFile('schema/schema.ts', 'const base = process.env.FOO_BASE_DOMAIN\nif (!base) throw 0\n')
    const report = await checkDomain(input({ requiredSecrets: ['FOO_KEY'] }))
    expect(report.findings).toEqual([])
    expect(hasError(report)).toBe(false)
  })
})
