import type { PublicationRelation, RemoteFailure } from '@shared/contracts/versions'

import { describe, expect, test } from 'bun:test'

import type { SceneNode } from '../scene/types'

import { bundledElk } from '../canvas/__tests__/bundled-elk'
import { closedLabels } from '../canvas/labels'
import { layoutArrangement } from '../canvas/layout'
import { estimateText, FONTS, READING_ZOOM, SECONDARY_TEXT } from '../canvas/metrics'
import { fitViewport } from '../canvas/viewport'
import { indexRows } from '../index-rail/model'
import { arrange } from '../scene/arrange'
import { type DomainFacts, IDLE, LOADING, ready } from './facts'
import {
  MAP_DOMAIN_BUDGET,
  OUTSIDE_GROUP,
  dependencyLinkId,
  domainNodeId,
  linkVerdict,
  originNodeId,
  projectWorkspace,
  targetOf,
} from './project'
import {
  ADMIN_LOCAL,
  ADMIN_ON_SHELL,
  ISSUES_INDEX,
  ISSUES_LOCAL,
  adminFacts,
  failure,
  issuesFacts,
  ok,
  okValue,
  report,
  standing,
  summary,
  unjudged,
} from './test-fixtures'

const node = (scene: ReturnType<typeof projectWorkspace>, id: string): SceneNode => {
  const found = scene.nodes.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`no node ${id}`)
  return found
}
const badges = (scene: ReturnType<typeof projectWorkspace>, id: string) =>
  (node(scene, id).badges ?? []).map((badge) => badge.label)

describe('the Workspace map', () => {
  const scene = projectWorkspace([adminFacts(), issuesFacts()])

  test('each workspace Domain is one card: name, declared version, relation and changes', () => {
    const admin = node(scene, domainNodeId('admin'))
    expect(admin).toMatchObject({
      kind: 'Domain',
      label: 'Admin',
      sublabel: '0.1.0-beta.63',
      tone: 'node',
    })
    expect(badges(scene, domainNodeId('admin'))).toEqual([
      'never published',
      "changes can't be judged",
    ])
    expect(admin.badges?.[1]?.title).toBe(
      'Project definition may contain only domain, environments, entrypoints, and tests.',
    )
    const issues = node(scene, domainNodeId('issues'))
    expect(issues).toMatchObject({ label: 'Issues', sublabel: '0.8.8' })
    expect(issues.badges?.[0]).toEqual({ label: 'behind 0.9.1', tone: 'warning' })
    expect(issues.counts).toEqual([
      { label: 'changes', value: 0 },
      { label: 'dependencies', value: 2 },
    ])
    expect(issues.rows?.map((row) => [row.label, row.detail])).toEqual([
      ['revision', 'ce5f0919'],
      ['latest', '0.9.1'],
      ['publishes to', 'development · production'],
      ['git', 'no commit'],
    ])
    expect(issues.keywords).toEqual(['issues.astrale.ai', '@astrale-domains/issues'])
  })

  test('Domains outside the Workspace are quieter cards, never absent', () => {
    const kernel = node(scene, originNodeId('kernel.astrale.ai'))
    const shell = node(scene, originNodeId('shell.astrale.ai'))
    expect(kernel).toMatchObject({
      kind: 'other Domain',
      tone: 'muted',
      group: OUTSIDE_GROUP,
      sublabel: 'not in this Workspace',
    })
    expect(kernel.badges).toEqual([
      {
        label: 'not found',
        tone: 'muted',
        title:
          'No Domain kernel.astrale.ai is readable by this caller: it is absent, or the caller holds neither domain_installer nor domain_admin on it.',
      },
    ])
    expect(shell.badges?.map((badge) => badge.label)).toEqual(['6 Publications'])
    expect(scene.groups).toEqual([{ id: OUTSIDE_GROUP, label: 'Outside this Workspace' }])
    // a workspace Domain depended on is linked to its own card, not drawn again outside
    expect(
      scene.nodes.some((candidate) => candidate.id === originNodeId('issues.astrale.ai')),
    ).toBe(false)
  })

  test('each dependency is one link: its line says what its cards do not, in the verdict’s tone', () => {
    // the cards it joins name the two Domains; the line says the revision built against and
    // the verdict, and the Index, which lists the link without its cards, names it by its ends
    expect(
      scene.links.map((link) => [link.id, link.name, link.label, link.tone, link.dashed]),
    ).toEqual([
      [
        dependencyLinkId('admin', 'issues'),
        'Admin → Issues',
        'workspace copy · holds on all 3',
        'success',
        undefined,
      ],
      [
        dependencyLinkId('admin', 'kernel'),
        'Admin → Kernel',
        '29b082a7 · not found',
        'muted',
        true,
      ],
      [
        dependencyLinkId('admin', 'shell'),
        'Admin → Shell',
        '0.3.0 · breaks on 2 of 6',
        'warning',
        undefined,
      ],
      [
        dependencyLinkId('issues', 'kernel'),
        'Issues → Kernel',
        '29b082a7 · not found',
        'muted',
        true,
      ],
      [
        dependencyLinkId('issues', 'shell'),
        'Issues → Shell',
        '0.3.0 · holds on all 6',
        'success',
        undefined,
      ],
    ])
    const listed = indexRows(scene, { query: '', hidden: new Set() }, new Set()).filter(
      (row) => row.type === 'item' && row.kind === 'dependency',
    )
    expect(listed[0]).toMatchObject({
      id: dependencyLinkId('admin', 'issues'),
      label: 'Admin → Issues',
      sublabel: 'workspace copy · holds on all 3',
    })
    const toIssues = scene.links[0]!
    expect(toIssues.from.nodes).toEqual([domainNodeId('admin')])
    expect(toIssues.to.nodes).toEqual([domainNodeId('issues')])
    expect(toIssues.directed).toBe(true)
  })

  test('the same answers draw the same scene; a new answer draws a new one', () => {
    expect(projectWorkspace([adminFacts(), issuesFacts()]).key).toBe(scene.key)
    expect(projectWorkspace([adminFacts(), issuesFacts({ changes: LOADING })]).key).not.toBe(
      scene.key,
    )
  })

  test('a map of few Domains stands as a stack, and reads whole at 1280 × 720 beside the Inspector', async () => {
    const services = issuesFacts({
      summary: summary('services', 'services.astrale.ai'),
      local: ready({
        ...ISSUES_LOCAL,
        domainId: 'services',
        origin: 'services.astrale.ai',
        dependencies: [ISSUES_LOCAL.dependencies[0]!],
      }),
    })
    const map = projectWorkspace([adminFacts(), issuesFacts(), services])
    const arrangement = arrange(map, { collapsed: new Set() })
    const placement = await layoutArrangement(arrangement, 'compact', estimateText, bundledElk())
    const box = (id: string) => placement.boxes.get(id)!
    const below = (upper: string, lower: string) => box(upper).y + box(upper).height <= box(lower).y
    // what each Domain depends on stands below it, the Domains outside the Workspace lowest
    expect(below(domainNodeId('admin'), domainNodeId('issues'))).toBe(true)
    expect(below(domainNodeId('issues'), originNodeId('kernel.astrale.ai'))).toBe(true)
    expect(below(domainNodeId('services'), originNodeId('shell.astrale.ai'))).toBe(true)
    // every line says its name
    expect(closedLabels(map, arrangement, placement, estimateText).size).toBe(
      arrangement.trunks.length,
    )
    // the pane a 1280 × 720 window leaves the map with the Inspector open, under the toolbar
    // and over the composer: the smallest text a card or a line carries reads as the Index's
    const pane = { width: 820, height: 672 }
    const insets = { top: 44, right: 0, bottom: 88, left: 0 }
    const { zoom } = fitViewport(placement.bounds, pane, { insets, maxZoom: READING_ZOOM })
    expect(zoom).toBe(READING_ZOOM)
    expect(Math.min(FONTS.badge.size, FONTS.linkLabel.size) * zoom).toBeCloseTo(SECONDARY_TEXT)
  })
})

describe('each PublicationRelation on a card', () => {
  const cases: Array<[PublicationRelation, string, string]> = [
    [{ kind: 'never-published', registered: false }, 'never published', 'muted'],
    [{ kind: 'same-revision', latest: '0.9.1' }, 'same revision as 0.9.1', 'muted'],
    [{ kind: 'ahead', latest: '0.9.1' }, 'ahead of 0.9.1', 'node'],
    [{ kind: 'version-taken', latest: '0.9.1' }, 'version taken', 'warning'],
    [{ kind: 'behind', latest: '0.9.1' }, 'behind 0.9.1', 'warning'],
    [{ kind: 'undetermined', reason: 'The local revision is unknown.' }, "can't tell", 'muted'],
  ]
  for (const [relation, label, tone] of cases) {
    test(relation.kind, () => {
      const scene = projectWorkspace([
        issuesFacts({ standing: ready(standing(ISSUES_LOCAL, relation, ISSUES_INDEX)) }),
      ])
      expect(node(scene, domainNodeId('issues')).badges?.[0]).toMatchObject({ label, tone })
    })
  }

  test('a standing still read, or not answered', () => {
    const reading = projectWorkspace([issuesFacts({ standing: LOADING })])
    expect(badges(reading, domainNodeId('issues'))[0]).toBe('reading the registry…')
    const broken = projectWorkspace([
      issuesFacts({ standing: { status: 'error', message: 'socket hang up' } }),
    ])
    expect(node(broken, domainNodeId('issues')).badges?.[0]).toEqual({
      label: "can't tell",
      tone: 'muted',
      title: 'socket hang up',
    })
  })
})

describe('each Remote status on the map', () => {
  const statuses: Array<[RemoteFailure['status'], string]> = [
    ['signed-out', 'signed out'],
    ['offline', 'offline'],
    ['not-found', 'not found'],
    ['refused', 'refused'],
    ['failed', "can't tell"],
  ]
  for (const [status, words] of statuses) {
    test(status, () => {
      const answer = failure(status, `the registry said ${status}`)
      const facts = issuesFacts({
        changes: ready(answer),
        dependencies: ready({
          domainId: 'issues',
          origin: 'issues.astrale.ai',
          revision: ISSUES_LOCAL.revision,
          dependencies: [
            {
              alias: 'shell',
              origin: 'shell.astrale.ai',
              builtAgainst: ISSUES_LOCAL.dependencies[1]!.revision,
              local: null,
              index: answer,
              carriedBy: [],
            },
          ],
        }),
        compatibility: ready({
          domainId: 'issues',
          origin: 'issues.astrale.ai',
          revision: ISSUES_LOCAL.revision,
          dependencies: [
            {
              origin: 'shell.astrale.ai',
              builtAgainst: ISSUES_LOCAL.dependencies[1]!.revision,
              publications: answer,
              local: null,
            },
          ],
        }),
      })
      const scene = projectWorkspace([facts])
      // the local facts stand: name, version, revision
      expect(node(scene, domainNodeId('issues'))).toMatchObject({
        label: 'Issues',
        sublabel: '0.8.8',
      })
      // a cause of the session's is said as the session's, with what ends it; any other is the
      // Domain's own changes that cannot be judged, in the registry's words
      const card = node(scene, domainNodeId('issues')).badges ?? []
      if (status === 'signed-out' || status === 'offline') {
        expect(card.find((badge) => badge.label === words)?.title).toMatch(/then read again\.$/)
        expect(card.map((badge) => badge.label)).not.toContain("changes can't be judged")
      } else
        expect(card.find((badge) => badge.label === "changes can't be judged")?.title).toBe(
          `the registry said ${status}`,
        )
      expect(badges(scene, originNodeId('shell.astrale.ai'))).toEqual([words])
      const link = scene.links.find(
        (candidate) => candidate.id === dependencyLinkId('issues', 'shell'),
      )!
      expect(link.label).toBe(`a51bf60f · ${words}`)
      expect(link.tone).toBe('muted')
      expect(link.dashed).toBe(true)
    })
  }
})

describe('changes on a card', () => {
  test('the required bump, and the version to declare', () => {
    const scene = projectWorkspace([
      issuesFacts({
        changes: ready(
          ok(
            report({
              baseline: '0.9.1',
              level: 'minor',
              effective: 'minor',
              accepted: false,
              next: '0.10.0',
              changes: [
                {
                  subject: 'issues.astrale.ai:class.Label',
                  facet: 'class.reference',
                  state: 'added',
                  bump: 'minor',
                  reason: 'addition',
                },
              ],
            }),
          ),
        ),
      }),
    ])
    expect(badges(scene, domainNodeId('issues'))).toEqual([
      'behind 0.9.1',
      'minor bump',
      'declare 0.10.0',
    ])
  })

  test('a registry the session refuses is said once, as the panel says it', () => {
    const signedOut = failure('signed-out', 'not signed in')
    const refusedIndex = ready(
      standing(ISSUES_LOCAL, { kind: 'undetermined', reason: 'unread' }, signedOut),
    )
    // its index read refused, the card never says a judgement is running, nor "can't tell"
    const judging = projectWorkspace([issuesFacts({ standing: refusedIndex, changes: LOADING })])
    expect(node(judging, domainNodeId('issues')).badges).toEqual([
      {
        label: 'signed out',
        tone: 'muted',
        title: 'Sign in with the astrale CLI, then read again.',
      },
    ])
    // the judgement refused in turn: still said once
    const judged = projectWorkspace([
      issuesFacts({ standing: refusedIndex, changes: ready(signedOut) }),
    ])
    expect(badges(judged, domainNodeId('issues'))).toEqual(['signed out'])
    // a change report that fails for a reason of the Domain's own keeps saying so
    const own = projectWorkspace([
      issuesFacts({
        standing: refusedIndex,
        changes: ready(failure('failed', 'the platform refuses its sources')),
      }),
    ])
    expect(badges(own, domainNodeId('issues'))).toEqual(['signed out', "changes can't be judged"])
  })

  test('judging, then folded when never asked for', () => {
    expect(
      badges(projectWorkspace([issuesFacts({ changes: LOADING })]), domainNodeId('issues')),
    ).toContain('judging changes…')
    const scene = projectWorkspace([unjudged(issuesFacts()), adminFacts()])
    expect(scene.folded).toEqual([
      {
        label: 'Not judged',
        count: 1,
        reason: 'select a Domain to judge its changes and compatibility',
      },
    ])
    const link = scene.links.find(
      (candidate) => candidate.id === dependencyLinkId('issues', 'shell'),
    )!
    // not judged: the line says what it is built against, and no verdict, in no verdict's tone
    expect(link.label).toBe('0.3.0')
    expect(link.tone).toBeUndefined()
    expect(link.dashed).toBe(true)
  })

  test('build problems are said on the card', () => {
    const scene = projectWorkspace([
      adminFacts({
        summary: summary('admin', 'admin.astrale.ai', { depsInstalled: false }),
        local: ready({
          ...ADMIN_LOCAL,
          revision: null,
          revisionError: 'The SDK refused the Schema.',
        }),
      }),
    ])
    expect(badges(scene, domainNodeId('admin'))).toContain('dependencies not installed')
    expect(
      node(scene, domainNodeId('admin')).badges?.find(
        (badge) => badge.label === 'Schema not admitted',
      )?.title,
    ).toBe('The SDK refused the Schema.')
    const unreadable = projectWorkspace([
      adminFacts({ local: { status: 'error', message: 'EACCES' } }),
    ])
    expect(badges(unreadable, domainNodeId('admin'))).toContain('sources unreadable')
  })
})

describe('the cost guard', () => {
  test(`at most ${MAP_DOMAIN_BUDGET} Domains are drawn; the rest are folded and said`, () => {
    const many: DomainFacts[] = Array.from({ length: MAP_DOMAIN_BUDGET + 5 }, (_, index) =>
      unjudged(
        issuesFacts({
          summary: summary(`domain-${index}`, `d${index}.astrale.test`),
          local: ready({
            ...ISSUES_LOCAL,
            domainId: `domain-${index}`,
            origin: `d${index}.astrale.test`,
            dependencies: [],
          }),
          dependencies: IDLE,
        }),
      ),
    )
    const scene = projectWorkspace(many)
    expect(scene.nodes).toHaveLength(MAP_DOMAIN_BUDGET)
    expect(scene.folded[0]).toEqual({
      label: 'Domains',
      count: 5,
      reason: `not drawn: the map draws at most ${MAP_DOMAIN_BUDGET}; the Workspace panel lists every one`,
    })
  })
})

describe('map ids', () => {
  test('every id names its target', () => {
    expect(targetOf(domainNodeId('admin'))).toEqual({ kind: 'domain', domainId: 'admin' })
    expect(targetOf(originNodeId('shell.astrale.ai'))).toEqual({
      kind: 'origin',
      origin: 'shell.astrale.ai',
    })
    expect(targetOf(dependencyLinkId('domain-a14a2db6', 'shell'))).toEqual({
      kind: 'dependency',
      domainId: 'domain-a14a2db6',
      alias: 'shell',
    })
    expect(targetOf(undefined)).toBeUndefined()
    expect(targetOf('class.Fleet')).toBeUndefined()
  })
})

describe('a link verdict', () => {
  test('follows the compatibility fact', () => {
    expect(linkVerdict(LOADING, undefined)).toEqual({
      label: 'judging…',
      breaks: false,
      judged: false,
    })
    expect(linkVerdict({ status: 'error', message: 'down' }, undefined)).toEqual({
      label: "can't tell",
      breaks: false,
      judged: false,
      title: 'down',
    })
    expect(linkVerdict(IDLE, undefined)).toEqual({ breaks: false, judged: false })
    expect(linkVerdict(ready(null), ADMIN_ON_SHELL)).toEqual({
      label: 'breaks on 2 of 6',
      breaks: true,
      judged: true,
    })
  })

  test('a workspace copy that breaks is said even when the registry cannot answer', () => {
    const local = {
      domainId: 'issues',
      verdict: ok({
        ...okValue(okValue(ADMIN_ON_SHELL.publications)[4]!.verdict),
      }),
    }
    expect(
      linkVerdict(ready(null), { ...ADMIN_ON_SHELL, publications: failure('offline'), local }),
    ).toMatchObject({ label: 'breaks the workspace copy', breaks: true })
    expect(linkVerdict(ready(null), { ...ADMIN_ON_SHELL, local })).toMatchObject({
      label: 'breaks on 2 of 6 · breaks the workspace copy',
      breaks: true,
    })
  })
})
