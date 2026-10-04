import type { InstalledRelease } from '@astrale-os/sdk/client/schema'

import { describe, expect, test } from 'bun:test'
import { Command } from 'commander'

import type { ServedDeployment } from '../../lib/domain-release'

import { AstraleError } from '../../errors'
import { registerCommand } from '../../program/registry'
import { splitIssuerChangeValues } from '../domain/install'
import {
  admitIssuerChange,
  consentedByFlags,
  deploymentLineOf,
  firstInstallNotice,
  issuerChangeConsent,
  issuerChangeLine,
  issuerConsentRequest,
  IssuerChangeNotConsentedError,
  plannedIssuerChange,
  type IssuerChange,
} from '../domain/issuer-consent'

const LINE = 'shell-aaaaaaaaaaaaaaaa'
const deployment = (line: string, content: string, domain = 'astrale.app', scheme = 'https') =>
  `${scheme}://${line}-${content}.${domain}`
const S1 = deployment(LINE, 'bbbbbbbbbbbbbbbb')
const S2 = deployment(LINE, 'cccccccccccccccc')
const OTHER_LINE = deployment('shell-dddddddddddddddd', 'bbbbbbbbbbbbbbbb')
const LEGACY = 'https://shell-v3.beta.astrale.ai'
const digest = (seed: string) => `sha256:${seed.repeat(64)}` as const

function served(url: string, pin: 'release' | 'legacy' = 'release'): ServedDeployment {
  return {
    origin: 'shell.astrale.ai',
    issuer: url,
    revision: 'r1',
    pin:
      pin === 'release'
        ? { kind: 'release', release: digest('1'), build: digest('2') }
        : { kind: 'legacy', document: 3, etag: digest('3') },
  } as ServedDeployment
}

function installed(issuer: string): InstalledRelease {
  return {
    origin: 'shell.astrale.ai',
    revision: 'r0',
    issuer,
    url: issuer,
    pin: { kind: 'release', release: digest('9'), build: digest('8') },
    inFlight: [],
  } as unknown as InstalledRelease
}

describe('issuer-change consent flags', () => {
  test('a bare flag consents to same-line changes, a valued one to its origin', () => {
    expect(issuerChangeConsent(['', 'crm.acme.dev', 'crm.acme.dev'], true)).toEqual({
      sameLine: true,
      origins: ['crm.acme.dev'],
      revokePrevious: true,
    })
    expect(issuerChangeConsent(undefined, undefined)).toEqual({
      sameLine: false,
      origins: [],
      revokePrevious: false,
    })
  })

  test('refuses a value that does not name an origin', () => {
    for (const value of ['https://crm.acme.dev', 'crm.acme.dev/x', 'a b']) {
      expect(() => issuerChangeConsent([value], false)).toThrow(AstraleError)
    }
  })

  test('a URL written after the flag goes back to the references', () => {
    expect(splitIssuerChangeValues(['https://b.test'], ['https://a.test', 'crm.test'])).toEqual({
      references: ['https://a.test', 'https://b.test'],
      values: ['', 'crm.test'],
    })
    expect(splitIssuerChangeValues(['https://b.test'], undefined)).toEqual({
      references: ['https://b.test'],
      values: undefined,
    })
  })

  test('the command collects every occurrence, a bare one as the empty string', async () => {
    const program = new Command().exitOverride()
    let seen: unknown
    registerCommand(program, {
      name: 'install',
      description: 'test',
      arguments: [{ name: 'references', description: 'refs', required: false, variadic: true }],
      options: [{ flags: '--allow-issuer-change [origin]', description: 'test', repeatable: true }],
      action: (async (_references: string[], opts: { allowIssuerChange?: string[] }) => {
        seen = opts.allowIssuerChange
      }) as never,
    })
    await program.parseAsync(
      [
        'install',
        '--allow-issuer-change',
        '--allow-issuer-change=a.test',
        'https://x.test',
        '--allow-issuer-change',
        'b.test',
      ],
      { from: 'user' },
    )
    expect(seen).toEqual(['', 'a.test', 'b.test'])
  })
})

describe('deployment lines', () => {
  test('reads the line and routing domain of an immutable deployment address', () => {
    expect(deploymentLineOf(S1)).toEqual({
      scheme: 'https:',
      routingDomain: 'astrale.app',
      line: LINE,
    })
    expect(deploymentLineOf(`${S1}/`)).toEqual(deploymentLineOf(S1))
  })

  test('a legacy issuer, a path or a single label is no deployment line', () => {
    expect(deploymentLineOf(LEGACY)).toBeUndefined()
    expect(deploymentLineOf(`${S1}/kernel`)).toBeUndefined()
    expect(deploymentLineOf(`https://${LINE}-bbbbbbbbbbbbbbbb`)).toBeUndefined()
    expect(deploymentLineOf('not a url')).toBeUndefined()
  })

  test('a new deployment of the installed issuer line is a same-line change', () => {
    expect(issuerChangeLine(S1, S2, S2)).toBe('same')
    // The port is not part of the line (a local Host serves each deployment on its own port).
    expect(
      issuerChangeLine(
        deployment(LINE, 'bbbbbbbbbbbbbbbb', 'localhost:4001', 'http'),
        deployment(LINE, 'cccccccccccccccc', 'localhost:4002', 'http'),
        deployment(LINE, 'cccccccccccccccc', 'localhost:4002', 'http'),
      ),
    ).toBe('same')
  })

  test('another line, routing domain or scheme, or a legacy issuer, is a cross-line change', () => {
    expect(issuerChangeLine(S1, OTHER_LINE, OTHER_LINE)).toBe('cross')
    const elsewhere = deployment(LINE, 'cccccccccccccccc', 'other.app')
    expect(deploymentLineOf(elsewhere)?.line).toBe(LINE)
    expect(issuerChangeLine(S1, elsewhere, elsewhere)).toBe('cross')
    expect(
      issuerChangeLine(S1, deployment(LINE, 'cccccccccccccccc', 'astrale.app', 'http'), S2),
    ).toBe('cross')
    // Legacy to its first v4 deployment, and back.
    expect(issuerChangeLine(LEGACY, S1, S1)).toBe('cross')
    expect(issuerChangeLine(S1, LEGACY, LEGACY)).toBe('cross')
    // The served issuer decides with the URL: a same-line URL serving another line is cross-line.
    expect(issuerChangeLine(S1, OTHER_LINE, S2)).toBe('cross')
  })
})

describe('planned issuer changes', () => {
  test('a change only when the origin is installed under another issuer', () => {
    expect(plannedIssuerChange(S2, served(S2), [])).toBeUndefined()
    expect(plannedIssuerChange(S2, served(S2), [installed(S2)])).toBeUndefined()
    expect(plannedIssuerChange(S2, served(S2), [installed(S1)])).toEqual({
      origin: 'shell.astrale.ai',
      reference: S2,
      from: S1,
      to: S2,
      line: 'same',
    })
  })

  test('the flags consent to a same-line change in either form, to any other only by origin', () => {
    const same = plannedIssuerChange(S2, served(S2), [installed(S1)])!
    const cross = plannedIssuerChange(OTHER_LINE, served(OTHER_LINE), [installed(S1)])!
    const bare = issuerChangeConsent([''], false)
    const scoped = issuerChangeConsent(['shell.astrale.ai'], false)
    expect(consentedByFlags(same, bare)).toBe(true)
    expect(consentedByFlags(same, scoped)).toBe(true)
    expect(consentedByFlags(cross, bare)).toBe(false)
    expect(consentedByFlags(cross, scoped)).toBe(true)
    expect(consentedByFlags(cross, issuerChangeConsent(['crm.acme.dev'], false))).toBe(false)
  })

  test('the request consent names both issuers and only a revoke', () => {
    const change = plannedIssuerChange(S2, served(S2), [installed(S1)])!
    expect(issuerConsentRequest(change, issuerChangeConsent([''], false))).toEqual({
      issuer: { from: S1, to: S2 },
    })
    expect(issuerConsentRequest(change, issuerChangeConsent([''], true))).toEqual({
      issuer: { from: S1, to: S2 },
      previous: 'revoke',
    })
  })
})

describe('admitting an issuer change', () => {
  const cross: IssuerChange = {
    origin: 'shell.astrale.ai',
    reference: OTHER_LINE,
    from: S1,
    to: OTHER_LINE,
    line: 'cross',
  }

  test('a typed confirmation at a terminal consents to a cross-line change', async () => {
    const asked: string[] = []
    await admitIssuerChange(cross, issuerChangeConsent([''], false), true, async (_, expected) => {
      asked.push(expected)
      return true
    })
    expect(asked).toEqual(['shell.astrale.ai'])
  })

  test('without a covering flag or a confirmation the change is refused with its line', async () => {
    const refusal = admitIssuerChange(
      cross,
      issuerChangeConsent([''], false),
      true,
      async () => false,
    )
    await expect(refusal).rejects.toBeInstanceOf(IssuerChangeNotConsentedError)
    await expect(refusal).rejects.toMatchObject({
      code: 'ISSUER_CHANGE_NOT_CONSENTED',
      details: {
        origin: 'shell.astrale.ai',
        line: 'cross',
        installedIssuer: S1,
        replacementIssuer: OTHER_LINE,
      },
    })
  })

  test('a covering flag never asks', async () => {
    await admitIssuerChange(cross, issuerChangeConsent(['shell.astrale.ai'], false), true, () => {
      throw new Error('asked')
    })
  })
})

describe('first install notice', () => {
  test('a release claiming another origin than its host is noted, nothing else', () => {
    expect(firstInstallNotice(served(S1), S1)).toBe(
      `origin shell.astrale.ai claimed by unverified deployment ${S1}`,
    )
    expect(firstInstallNotice(served(LEGACY, 'legacy'), LEGACY)).toBeUndefined()
    expect(
      firstInstallNotice(
        { ...served(S1), origin: 'shell.astrale.app' },
        'https://shell.astrale.app',
      ),
    ).toBeUndefined()
  })
})
