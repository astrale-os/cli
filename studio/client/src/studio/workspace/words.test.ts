import type { PublicationRelation, RemoteFailure } from '@shared/contracts/versions'

import { describe, expect, test } from 'bun:test'

import { LOADING, ready } from './facts'
import {
  ADMIN_ON_ISSUES,
  ADMIN_ON_KERNEL,
  ADMIN_ON_SHELL,
  GROUP_PROPERTIES,
  ISSUES_INDEX,
  NOT_FOUND,
  REVISION,
  ROLE_MISSING,
  SHELL_INDEX,
  adminFacts,
  dependencyStanding,
  failure,
  issuesFacts,
  ok,
  readyValue,
  report,
  standing,
  summary,
  verdict,
} from './test-fixtures'
import {
  attentionSentences,
  builtAgainstSentence,
  changeSentence,
  changesByBump,
  differenceSentence,
  domainName,
  environmentsSentence,
  failureWords,
  gitSentence,
  keyText,
  nextVersion,
  reasonSentence,
  relationLabel,
  relationNeedsAction,
  relationSentence,
  reportSentences,
  tally,
  tallyLabel,
  tallySentence,
  unsatisfiedSentence,
  unsatisfiedSummary,
  usagesSentence,
  verdictGroups,
  verdictLabel,
  verdictSentence,
} from './words'

const FACTS = { origin: 'issues.astrale.ai', declared: '0.8.8' }

describe('each PublicationRelation reads as a badge and a sentence', () => {
  const cases: Array<[PublicationRelation, string, boolean, string]> = [
    [
      { kind: 'never-published', registered: true },
      'never published',
      false,
      'Never published: the registry lists issues.astrale.ai, but no Publication of it.',
    ],
    [
      { kind: 'never-published', registered: false },
      'never published',
      false,
      'Never published: the registry has no Domain issues.astrale.ai this session can read. It is absent, or this session may not read it.',
    ],
    [
      { kind: 'same-revision', latest: '0.9.1' },
      'same revision as 0.9.1',
      false,
      'Same revision as the latest Publication, 0.9.1: these sources carry the Schema it published.',
    ],
    [
      { kind: 'ahead', latest: '0.8.7' },
      'ahead of 0.8.7',
      false,
      'Ahead: 0.8.8 is above the latest Publication, 0.8.7, whose Schema revision differs.',
    ],
    [
      { kind: 'version-taken', latest: '0.9.1' },
      'version taken',
      true,
      'Version taken: 0.8.8 is already published under another Schema revision. Raise the version before publishing.',
    ],
    [
      { kind: 'behind', latest: '0.9.1' },
      'behind 0.9.1',
      true,
      'Behind: 0.8.8 is below the latest Publication, 0.9.1, whose Schema revision differs from these sources.',
    ],
    [
      {
        kind: 'undetermined',
        reason: 'The registry index could not be read: No default identity.',
      },
      "can't tell",
      false,
      "Can't tell where it stands. The registry index could not be read: No default identity.",
    ],
  ]
  for (const [relation, label, needsAction, sentence] of cases) {
    test(`${relation.kind}${'registered' in relation ? ` (registered: ${relation.registered})` : ''}`, () => {
      expect(relationLabel(relation)).toBe(label)
      expect(relationNeedsAction(relation)).toBe(needsAction)
      expect(relationSentence(relation, FACTS)).toBe(sentence)
    })
  }

  test('a Domain whose origin and version are unread is still named', () => {
    expect(
      relationSentence({ kind: 'behind', latest: '1.0.0' }, { origin: null, declared: null }),
    ).toBe(
      'Behind: its version is below the latest Publication, 1.0.0, whose Schema revision differs from these sources.',
    )
  })
})

describe('each Remote status says what happened and what to do', () => {
  const statuses: Array<[RemoteFailure['status'], string, string]> = [
    [
      'signed-out',
      "Signed out: this Studio's astrale session cannot read the Publications of shell.astrale.ai.",
      'Sign in with the astrale CLI, then read again.',
    ],
    [
      'offline',
      'The registry could not be reached for the Publications of shell.astrale.ai.',
      'Check the connection, then read again.',
    ],
    [
      'not-found',
      'The registry has nothing readable for the Publications of shell.astrale.ai.',
      'It is absent, or this session may not read it.',
    ],
    [
      'refused',
      'The registry refused to answer the Publications of shell.astrale.ai.',
      'Its reason is below.',
    ],
    [
      'failed',
      'No usable answer for the Publications of shell.astrale.ai.',
      'The reason is below; read again once it is fixed.',
    ],
  ]
  for (const [status, headline, remedy] of statuses) {
    test(status, () => {
      expect(failureWords(failure(status), 'the Publications of shell.astrale.ai')).toEqual({
        headline,
        remedy,
      })
    })
  }
})

describe('names and Keys', () => {
  test('a Domain is named by its origin', () => {
    expect(domainName('shell.astrale.ai')).toBe('Shell')
    expect(domainName('compact-qa-20261124-bd02.astrale.test')).toBe('Compact-qa-20261124-bd02')
  })

  test('a Key says its origin only away from home', () => {
    expect(keyText('shell.astrale.ai:class.Group.property.directory', 'admin.astrale.ai')).toBe(
      'property directory of Group (shell)',
    )
    expect(keyText('admin.astrale.ai:class.Domain.method.grantAccess', 'admin.astrale.ai')).toBe(
      'method grantAccess of Domain',
    )
    expect(keyText('kernel.astrale.ai:core.root', 'admin.astrale.ai')).toBe(
      'core Node root (kernel)',
    )
    expect(keyText('issues.astrale.ai')).toBe('issues.astrale.ai')
  })
})

describe('local facts in sentences', () => {
  test('git provenance', () => {
    expect(gitSentence(null)).toBe(
      'Not in a git repository with a commit: a Publish records no commit, and needs --allow-dirty.',
    )
    expect(gitSentence({ commit: '1f8e2c52aa', dirty: true })).toBe(
      'At commit 1f8e2c5, with uncommitted changes: a Publish records the tree as dirty, and needs --allow-dirty.',
    )
    expect(gitSentence({ commit: '1f8e2c52aa', dirty: false })).toBe(
      'At commit 1f8e2c5, with a clean working tree.',
    )
  })

  test('Environments', () => {
    expect(environmentsSentence({ declared: false, environments: [], complete: true })).toBe(
      'The Project declares no Environments: it cannot publish until astrale.config.ts declares one.',
    )
    expect(
      environmentsSentence({
        declared: true,
        environments: [{ name: 'development' }, { name: 'production' }],
        complete: false,
      }),
    ).toBe(
      'Publishes to development or production. Some entries are not statically readable, so it may declare more.',
    )
  })
})

describe('the change report in sentences', () => {
  test('nothing compared: accepted', () => {
    expect(reportSentences(report())).toEqual([
      'No stable version up to 0.8.8 is published, so nothing is compared: 0.8.8 is accepted.',
    ])
  })

  test('an unregistered origin accepts any version', () => {
    expect(reportSentences(report({ registry: 'unregistered' }))).toEqual([
      'No Domain issues.astrale.ai is readable in the registry, so nothing is compared: any version is accepted.',
    ])
  })

  test('a refused version names the one to declare, with the 0.x rule', () => {
    const refused = report({
      declared: '0.9.2',
      baseline: '0.9.1',
      level: 'major',
      effective: 'minor',
      minimum: '0.10.0-0',
      next: '0.10.0',
      accepted: false,
      changes: [
        {
          subject: 'issues.astrale.ai:class.Issue.property.priority',
          facet: 'property.required',
          state: 'changed',
          bump: 'major',
          reason: 'unsatisfied-requirement',
          detail: 'optional → required',
        },
        {
          subject: 'issues.astrale.ai:class.Label',
          facet: 'class.reference',
          state: 'added',
          bump: 'minor',
          reason: 'addition',
        },
      ],
    })
    expect(reportSentences(refused)).toEqual([
      '2 changes since 0.9.1.',
      'They require a major bump; under the 0.x rule that is a minor bump.',
      '0.9.2 does not reach it: declare 0.10.0 in package.json. The smallest version the changes admit is 0.10.0-0.',
    ])
    expect(nextVersion(refused)).toBe('0.10.0')
    expect(changesByBump(refused.changes).map((group) => group.bump)).toEqual(['major', 'minor'])
    expect(changeSentence(refused.changes[0]!, 'issues.astrale.ai')).toBe(
      'Property priority of Issue changed whether it is required (optional → required).',
    )
    expect(changeSentence(refused.changes[1]!, 'issues.astrale.ai')).toBe('Class Label was added.')
  })

  test('a published version is informational', () => {
    expect(reportSentences(report({ published: true, baseline: '0.8.8', level: 'patch' }))).toEqual(
      [
        '0.8.8 already names a Publication: this report is informational, and publishing it again tags no new version.',
        'Nothing changed since 0.8.8.',
        'They require a patch.',
      ],
    )
  })

  test('every reason the server gives is a sentence', () => {
    for (const reason of [
      'unsatisfied-requirement',
      'addition',
      'other-change',
      'equivalent-schema',
      'code-only',
    ] as const)
      expect(reasonSentence(reason)).toMatch(/requires a (major bump|minor bump|patch)\.$/)
  })
})

describe('dependency compatibility in sentences', () => {
  test('the revision built against, and which Publications carry it', () => {
    expect(
      builtAgainstSentence(
        dependencyStanding('shell', 'shell.astrale.ai', REVISION.shell030, SHELL_INDEX),
      ),
    ).toBe('Built against shell.astrale.ai 0.3.0 (revision a51bf60f).')
    expect(
      builtAgainstSentence(
        dependencyStanding('issues', 'issues.astrale.ai', REVISION.issues, ISSUES_INDEX, {
          domainId: 'issues',
          revision: REVISION.issues,
          atBuiltAgainst: true,
        }),
      ),
    ).toBe(
      'Built against issues.astrale.ai revision ce5f0919, which no Publication carries. The workspace copy is at that revision.',
    )
    expect(
      builtAgainstSentence(
        dependencyStanding('kernel', 'kernel.astrale.ai', REVISION.kernel, NOT_FOUND),
      ),
    ).toBe('Built against kernel.astrale.ai revision 29b082a7.')
  })

  test('a tally of the Publications', () => {
    const counts = tally(ADMIN_ON_SHELL)!
    expect(counts).toEqual({
      holds: 4,
      breaks: 2,
      unknown: 0,
      total: 6,
      breaking: ['0.1.1', '0.1.0'],
    })
    expect(tallyLabel(counts)).toBe('breaks on 2 of 6')
    expect(tallySentence(counts, 'Admin', 'shell.astrale.ai')).toBe(
      'Admin holds against 4 of 6 Publications of shell.astrale.ai. 0.1.1 and 0.1.0 break it.',
    )
    expect(tallyLabel(tally(ADMIN_ON_ISSUES)!)).toBe('holds on all 3')
    expect(tally(ADMIN_ON_KERNEL)).toBeUndefined()
  })

  test('a verdict that could not be read is counted apart', () => {
    const counts = tally({
      ...ADMIN_ON_ISSUES,
      publications: ok([
        { version: '0.9.1', yanked: false, verdict: ok(verdict('0.9.1', REVISION.issues091)) },
        { version: '0.9.0', yanked: false, verdict: failure('failed', 'compare crashed') },
      ]),
    })!
    expect(tallyLabel(counts)).toBe("holds on 1 of 2; 1 can't tell")
    expect(tallySentence(counts, 'Admin', 'issues.astrale.ai')).toBe(
      'Admin holds against 1 of 2 Publications of issues.astrale.ai. 1 verdict could not be read.',
    )
  })

  test('versions of one revision share one verdict, shown once', () => {
    const groups = verdictGroups(ADMIN_ON_SHELL)!
    expect(groups.map((group) => group.versions)).toEqual([
      ['0.4.0'],
      ['0.3.0'],
      ['0.2.1', '0.2.0'],
      ['0.1.1'],
      ['0.1.0'],
    ])
    expect(groups[2]!.yanked).toEqual(['0.2.0'])
    expect(verdictGroups(ADMIN_ON_KERNEL)).toBeUndefined()
  })

  test('verdicts read as labels and sentences', () => {
    const [v040, v030, v021, v011] = verdictGroups(ADMIN_ON_SHELL)!.map((group) =>
      group.verdict.status === 'ok' ? group.verdict.value : undefined,
    ) as [
      ReturnType<typeof verdict>,
      ReturnType<typeof verdict>,
      ReturnType<typeof verdict>,
      ReturnType<typeof verdict>,
    ]
    expect(verdictLabel(v040)).toBe('compatible')
    expect(verdictLabel(v030)).toBe('equivalent')
    expect(verdictLabel(v011)).toBe('breaks 2 requirements')
    expect(verdictSentence(v040, 'Admin')).toBe(
      'Admin still holds against 0.4.0: every requirement is satisfied.',
    )
    expect(verdictSentence(v030, 'Admin')).toBe('0.3.0 means exactly what Admin was built against.')
    expect(verdictSentence(v021, 'Admin', ['0.2.1', '0.2.0'])).toBe(
      'Admin still holds against 0.2.1 and 0.2.0: every requirement is satisfied.',
    )
    expect(verdictSentence(v011, 'Admin')).toBe(
      'Admin does not hold against 0.1.1: 2 requirements are unsatisfied.',
    )
    expect(unsatisfiedSummary(v011.unsatisfied)).toBe('2 Classes')
  })

  test('each broken requirement, and where it is used', () => {
    expect(unsatisfiedSentence(GROUP_PROPERTIES, 'Shell 0.1.1', 'admin.astrale.ai')).toBe(
      'Class Group (shell) differs in Shell 0.1.1: its properties.',
    )
    expect(unsatisfiedSentence(ROLE_MISSING, 'Shell 0.1.1', 'admin.astrale.ai')).toBe(
      'Class Role (shell) is missing from Shell 0.1.1.',
    )
    expect(usagesSentence(GROUP_PROPERTIES.usages, 'admin.astrale.ai')).toBe(
      'Required by method grantAccess of Domain as a value type; by method revokeAccess of Domain as a value type; and 1 more.',
    )
    expect(usagesSentence(ROLE_MISSING.usages, 'admin.astrale.ai')).toBe(
      'Required by method grantAccess of Domain as a value type.',
    )
    expect(differenceSentence(GROUP_PROPERTIES.differences[0]!, 'admin.astrale.ai')).toBe(
      'Property icon of Iconable (kernel) is required, and absent.',
    )
  })
})

describe('what asks for action', () => {
  test('the Workspace as it was read', () => {
    expect(attentionSentences([adminFacts(), issuesFacts()])).toEqual({
      causes: [],
      sentences: [
        {
          domainId: 'admin',
          sentence:
            "Admin has changes that can't be judged and does not hold against 2 versions of Shell. The reason given: “Project definition may contain only domain, environments, entrypoints, and tests.”",
        },
        {
          domainId: 'issues',
          sentence: 'Issues declares 0.8.8 below the latest Publication, 0.9.1.',
        },
      ],
    })
  })

  test('signed out, the cause and what ends it are said once for every Domain it leaves unjudged', () => {
    const signedOut = failure('signed-out', 'No default identity.', 'NO_IDENTITY')
    const unread = ready(
      standing(
        readyValue(issuesFacts().local),
        { kind: 'undetermined', reason: 'signed out' },
        signedOut,
      ),
    )
    const judging = { standing: unread, changes: ready(signedOut), compatibility: LOADING }
    const attention = attentionSentences([
      adminFacts(judging),
      issuesFacts(judging),
      // still judging its changes: where it stands went unread for the same cause
      issuesFacts({
        summary: summary('shell', 'shell.astrale.ai'),
        local: LOADING,
        standing: unread,
        changes: LOADING,
      }),
    ])
    expect(attention.causes).toEqual([
      {
        status: 'signed-out',
        domainIds: ['admin', 'issues', 'shell'],
        sentence:
          "Signed out: this Studio's astrale session cannot read the registry, so Admin, Issues and Shell are not judged against it. Sign in with the astrale CLI, then read again.",
      },
    ])
    // no Domain repeats it
    expect(attention.sentences).toEqual([])
  })

  test('out of reach, said once; a Domain keeps what is its own to say', () => {
    const offline = failure('offline', 'fetch failed', 'NETWORK')
    const attention = attentionSentences([
      issuesFacts({ changes: ready(offline) }),
      adminFacts({ compatibility: LOADING }),
    ])
    expect(attention.causes).toEqual([
      {
        status: 'offline',
        domainIds: ['issues'],
        sentence:
          'The registry could not be reached, so Issues is not judged against it. Check the connection, then read again.',
      },
    ])
    expect(attention.sentences).toEqual([
      {
        domainId: 'issues',
        sentence: 'Issues declares 0.8.8 below the latest Publication, 0.9.1.',
      },
      {
        domainId: 'admin',
        sentence:
          "Admin has changes that can't be judged. The reason given: “Project definition may contain only domain, environments, entrypoints, and tests.”",
      },
    ])
  })

  test('a refused version and a taken one', () => {
    const facts = issuesFacts({
      standing: ready({
        ...readyValue(issuesFacts().standing),
        relation: { kind: 'version-taken', latest: '0.9.1' },
      }),
      changes: ready(
        ok(report({ baseline: '0.9.1', accepted: false, next: '0.10.0', level: 'minor' })),
      ),
    })
    expect(attentionSentences([facts]).sentences[0]!.sentence).toBe(
      'Issues declares 0.8.8, which is already published under another Schema revision and must declare 0.10.0 for its changes.',
    )
  })
})
