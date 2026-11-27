import type { Scenario } from '@shared/contracts/scenarios'
import type { StudioDataset } from '@shared/contracts/schema'

import { ANYONE } from '@shared/contracts/scenarios'
import { publishedDomainId } from '@shared/contracts/versions'
import { describe, expect, test } from 'bun:test'

import { LENS_KEYS } from '@/studio/lenses/keys'

import {
  type Address,
  addressOf,
  type DataSelection,
  formatAddress,
  isNewPlace,
  parseAddress,
  placeOf,
  resolveDataView,
} from './address'

const ISSUES = 'issues'
const PUBLICATION = publishedDomainId('issues.astrale.ai', '0.9.0')
const PRE_RELEASE = publishedDomainId('shell.astrale.ai', '0.7.0-beta.27')
const DATASET = './tests/datasets/triage.ts'

const roundTrip = (address: Address) => {
  const url = new URL(formatAddress(address), 'http://studio.test')
  return parseAddress(url.pathname, url.search)
}

/** Every selection kind the Schema canvas names, as the Studio writes them. */
const SCHEMA_SELECTIONS = [
  undefined,
  'class.Issue',
  'class.Issue.property.title',
  'class.Issue.method.close',
  'function.Issue.close',
  'function.triage',
  'module.schema/issues',
  'domain.issues.astrale.ai',
  'policy.canEdit',
  'class.Issue#read',
  'class.Issue#none',
  'class.Issue#holds',
  'class.Issue.method.close#call',
  'function.triage#call',
  'rules.functions',
  'constraint.no-self',
  'class.kernel.astrale.ai:class.Identity',
]

/** Every Data level view kind: a Node, an Edge, an identity, a verdict, a Scenario and its step. */
const DATA_VIEWS: DataSelection[] = [
  {},
  { selected: 'core.node.acme' },
  { selected: 'core.edge.3' },
  { selected: 'scenario.desk' },
  { identity: 'ann' },
  { selected: 'core.node.login', identity: 'ann', verdict: 'canEdit' },
  { scenario: 'desk' },
  { scenario: 'desk', step: 's2', selected: 'core.node.invoice-1', identity: 'ann' },
]

describe('an address reads back as the place it was written from', () => {
  test('the Workspace level, with each kind of map selection', () => {
    for (const map of [
      undefined,
      'domain:issues',
      'origin:shell.astrale.ai',
      'dependency:issues:kernel',
    ]) {
      const address: Address = { level: 'workspace', ...(map ? { map } : {}) }
      expect(roundTrip(address)).toEqual({ address })
    }
  })

  test('the Schema level of a workspace Domain and of a Publication, in each lens, with each selection', () => {
    for (const domainId of [ISSUES, PUBLICATION, PRE_RELEASE])
      for (const lens of [undefined, ...LENS_KEYS])
        for (const select of SCHEMA_SELECTIONS) {
          const address: Address = {
            level: 'domain',
            domainId,
            ...(lens ? { lens } : {}),
            ...(select ? { select } : {}),
          }
          expect([domainId, lens, select, roundTrip(address)]).toEqual([
            domainId,
            lens,
            select,
            { address },
          ])
        }
  })

  test('the Data level, in each lens, with each view', () => {
    for (const lens of [undefined, ...LENS_KEYS])
      for (const view of DATA_VIEWS)
        for (const dataset of [undefined, DATASET]) {
          const address: Address = {
            level: 'data',
            domainId: ISSUES,
            ...(dataset ? { dataset } : {}),
            ...(lens ? { lens } : {}),
            view,
          }
          expect([lens, view, roundTrip(address)]).toEqual([lens, view, { address }])
        }
  })

  test('the forms, as a reader sees them in the bar', () => {
    expect(formatAddress({ level: 'workspace' })).toBe('/workspace')
    expect(formatAddress({ level: 'workspace', map: 'dependency:issues:kernel' })).toBe(
      '/workspace?domain=issues&dependency=kernel',
    )
    expect(
      formatAddress({
        level: 'domain',
        domainId: ISSUES,
        lens: 'rules',
        select: 'class.Issue#read',
      }),
    ).toBe('/domain/issues?lens=rules&select=class.Issue%23read')
    expect(
      formatAddress({
        level: 'domain',
        domainId: PUBLICATION,
        lens: 'behavior',
      }),
    ).toBe('/publication/issues.astrale.ai/0.9.0?lens=behavior')
    expect(
      formatAddress({
        level: 'data',
        domainId: ISSUES,
        dataset: DATASET,
        lens: 'behavior',
        view: { scenario: 'desk', step: 's2', identity: 'ann', selected: 'core.node.acme' },
      }),
    ).toBe(
      '/domain/issues/data?dataset=.%2Ftests%2Fdatasets%2Ftriage.ts&lens=behavior&select=core.node.acme&as=ann&scenario=desk&step=s2',
    )
    // the parameters keep one order: equal places format equal, whatever order they were set in
    expect(
      formatAddress({
        level: 'data',
        domainId: ISSUES,
        view: { step: 's2', scenario: 'desk' },
      }),
    ).toBe('/domain/issues/data?scenario=desk&step=s2')
  })

  test('a view says only what is set: anyone is unsaid, a step needs its Scenario', () => {
    expect(parseAddress('/domain/issues/data', `?as=${ANYONE}&step=s2`)).toEqual({
      address: { level: 'data', domainId: ISSUES, view: {} },
    })
    expect(formatAddress({ level: 'data', domainId: ISSUES, view: { identity: ANYONE } })).toBe(
      '/domain/issues/data',
    )
  })
})

describe('an address that names no place says what it named', () => {
  test('bare `/` names no place: the Workspace state decides', () => {
    expect(parseAddress('/', '')).toEqual({})
  })

  test('a path the Studio does not have', () => {
    for (const path of [
      '/nowhere',
      '/domain',
      '/domain/issues/elsewhere',
      '/domain/issues/data/more',
      '/workspace/issues',
    ])
      expect(parseAddress(path, '')).toEqual({ unknown: `the path ${path}` })
    expect(parseAddress('/domain/%E0%A4%A', '')).toEqual({ unknown: 'the path /domain/%E0%A4%A' })
  })

  test('a Publication that is not one: a line, a tag, an origin that is no origin', () => {
    expect(parseAddress('/publication/issues.astrale.ai/latest', '')).toEqual({
      unknown: 'the Publication issues.astrale.ai latest',
    })
    expect(parseAddress('/publication/--json/1.0.0', '')).toEqual({
      unknown: 'the Publication --json 1.0.0',
    })
    expect(parseAddress('/publication/issues.astrale.ai', '')).toEqual({
      unknown: 'the path /publication/issues.astrale.ai',
    })
  })

  test('the retired Tests place lands on the Data level, the same dataset under Rules, and says so', () => {
    expect(parseAddress('/domain/issues/tests', `?dataset=${encodeURIComponent(DATASET)}`)).toEqual(
      {
        address: { level: 'data', domainId: ISSUES, dataset: DATASET, lens: 'rules', view: {} },
        retired: 'Tests',
      },
    )
    expect(parseAddress('/domain/issues/tests', '')).toEqual({
      address: { level: 'data', domainId: ISSUES, lens: 'rules', view: {} },
      retired: 'Tests',
    })
    // nothing writes it back: the place it lands on has its own address
    expect(
      formatAddress({ level: 'data', domainId: ISSUES, dataset: DATASET, lens: 'rules', view: {} }),
    ).toBe('/domain/issues/data?dataset=.%2Ftests%2Fdatasets%2Ftriage.ts&lens=rules')
  })

  test('a lens the Studio does not have reads the place without it, and is named', () => {
    expect(parseAddress('/domain/issues', '?lens=timeline&select=class.Issue')).toEqual({
      address: { level: 'domain', domainId: ISSUES, select: 'class.Issue' },
      unknown: 'the lens “timeline”',
    })
  })
})

describe('the address of what is shown', () => {
  const shown = {
    level: 'domain' as const,
    domainId: ISSUES,
    lens: 'structure' as const,
    dataset: null,
  }

  test('a Schema selection is written for the Domain it belongs to, and no other', () => {
    expect(addressOf({ ...shown, selected: 'class.Issue', selectionDomainId: ISSUES })).toEqual({
      level: 'domain',
      domainId: ISSUES,
      lens: 'structure',
      select: 'class.Issue',
    })
    expect(addressOf({ ...shown, selected: 'class.Host', selectionDomainId: 'admin' })).toEqual({
      level: 'domain',
      domainId: ISSUES,
      lens: 'structure',
    })
  })

  test('a Domain level with no Domain to read has no address; the Workspace always has one', () => {
    expect(addressOf({ ...shown, domainId: undefined })).toBeUndefined()
    expect(
      addressOf({ ...shown, level: 'workspace', domainId: undefined, map: 'domain:issues' }),
    ).toEqual({
      level: 'workspace',
      map: 'domain:issues',
    })
  })

  test('the Data level writes its dataset and its view; the Schema level no dataset', () => {
    expect(addressOf({ ...shown, dataset: DATASET })).toEqual({
      level: 'domain',
      domainId: ISSUES,
      lens: 'structure',
    })
    expect(
      addressOf({
        ...shown,
        level: 'data',
        lens: 'rules',
        dataset: DATASET,
        view: { identity: ANYONE, selected: 'core.node.acme', step: 'lost' },
      }),
    ).toEqual({
      level: 'data',
      domainId: ISSUES,
      dataset: DATASET,
      lens: 'rules',
      view: { selected: 'core.node.acme' },
    })
  })
})

describe('Back and Forward walk places, not selections', () => {
  const schema = (input: Partial<Extract<Address, { level: 'domain' }>> = {}): Address => ({
    level: 'domain',
    domainId: ISSUES,
    lens: 'structure',
    ...input,
  })
  const data = (input: Partial<Extract<Address, { level: 'data' }>> = {}): Address => ({
    level: 'data',
    domainId: ISSUES,
    lens: 'structure',
    view: {},
    ...input,
  })

  test('a lens, a level, a Domain or a dataset is a new place', () => {
    expect(isNewPlace(schema(), schema({ lens: 'rules' }))).toBe(true)
    expect(isNewPlace(schema(), { level: 'workspace' })).toBe(true)
    expect(isNewPlace({ level: 'workspace' }, schema())).toBe(true)
    expect(isNewPlace(schema(), schema({ domainId: PUBLICATION }))).toBe(true)
    expect(
      isNewPlace(data({ dataset: DATASET }), data({ dataset: './tests/datasets/other.ts' })),
    ).toBe(true)
    expect(isNewPlace(schema(), data({ dataset: DATASET }))).toBe(true)
  })

  test('a selection, a map selection, an identity or a step is the same place', () => {
    expect(isNewPlace(schema(), schema({ select: 'class.Issue' }))).toBe(false)
    expect(
      isNewPlace(schema({ select: 'class.Issue' }), schema({ select: 'function.triage' })),
    ).toBe(false)
    expect(isNewPlace({ level: 'workspace' }, { level: 'workspace', map: 'domain:issues' })).toBe(
      false,
    )
    expect(
      isNewPlace(
        data({ dataset: DATASET }),
        data({ dataset: DATASET, view: { scenario: 'desk', step: 's1', identity: 'ann' } }),
      ),
    ).toBe(false)
  })

  test('a place said more fully is the same place: the lens written', () => {
    expect(isNewPlace(schema({ lens: undefined }), schema())).toBe(false)
    expect(
      isNewPlace(data({ dataset: DATASET, lens: undefined }), data({ dataset: DATASET })),
    ).toBe(false)
    // and said less fully, it is a new one: the reader asked for it
    expect(isNewPlace(schema(), schema({ lens: undefined }))).toBe(true)
  })

  test("a Domain's Datasets page is a place of its own, apart from each dataset it lists", () => {
    expect(isNewPlace(data({ dataset: undefined }), data({ dataset: DATASET }))).toBe(true)
    expect(isNewPlace(data({ dataset: DATASET }), data({ dataset: undefined }))).toBe(true)
    expect(isNewPlace(data({ dataset: undefined }), data({ dataset: undefined }))).toBe(false)
    expect(
      isNewPlace(data({ dataset: undefined, lens: undefined }), data({ dataset: undefined })),
    ).toBe(false)
  })

  test('a place names no selection', () => {
    expect(placeOf(schema({ select: 'class.Issue' }))).toEqual({
      level: 'domain',
      domainId: ISSUES,
      lens: 'structure',
    })
    expect(placeOf({ level: 'workspace', map: 'domain:issues' })).toEqual({ level: 'workspace' })
  })
})

describe('what a Data level address names that the dataset no longer holds', () => {
  const dataset = {
    status: 'ready',
    path: DATASET,
    id: 'triage',
    origin: 'issues.astrale.ai',
    revision: 'r',
    schemaMatch: true,
    references: {},
    nodes: [{ path: 'ann' }, { path: 'acme' }, { path: 'login' }],
    edges: [{}, {}],
    variables: {},
  } as unknown as StudioDataset
  const desk: Scenario = {
    id: 'desk',
    dataset: DATASET,
    name: 'Support desk',
    steps: [{ id: 's1', does: 'read', on: { node: 'acme' }, as: 'ann', expect: 'allowed' }],
  }

  test('what it still holds is kept whole', () => {
    const view = {
      selected: 'core.node.acme',
      identity: 'ann',
      verdict: 'canEdit',
      scenario: 'desk',
      step: 's1',
    }
    expect(resolveDataView(dataset, view, [desk])).toEqual({ view, missing: [] })
    expect(resolveDataView(dataset, { selected: 'core.edge.1' }, [])).toEqual({
      view: { selected: 'core.edge.1' },
      missing: [],
    })
  })

  test('a Node, an Edge, an identity, a Scenario or a step that is gone is let go, and named', () => {
    expect(resolveDataView(dataset, { selected: 'core.node.gone' }, undefined)).toEqual({
      view: {},
      missing: ['the Node gone'],
    })
    expect(resolveDataView(dataset, { selected: 'core.edge.2' }, undefined)).toEqual({
      view: {},
      missing: ['the Edge core.edge.2'],
    })
    expect(
      resolveDataView(dataset, { identity: 'bob', selected: 'core.node.ann' }, undefined),
    ).toEqual({
      view: { selected: 'core.node.ann' },
      missing: ['the identity bob'],
    })
    expect(resolveDataView(dataset, { scenario: 'lost', step: 's1' }, [desk])).toEqual({
      view: {},
      missing: ['the Scenario lost'],
    })
    expect(resolveDataView(dataset, { scenario: 'desk', step: 's9' }, [desk])).toEqual({
      view: { scenario: 'desk' },
      missing: ['the step s9 of Support desk'],
    })
  })

  test('Scenarios not read yet leave the Scenario and its step as named', () => {
    expect(resolveDataView(dataset, { scenario: 'lost', step: 's9' }, undefined)).toEqual({
      view: { scenario: 'lost', step: 's9' },
      missing: [],
    })
  })
})
