import type { DomainAnatomy, ViewInfo, ViewReachRead } from '@shared/contracts/schema'
import type { InstanceInfo } from '@shared/contracts/workspace'

import { publishedDomainId } from '@shared/contracts/versions'
import { describe, expect, test } from 'bun:test'

import type { Scene } from '../scene/types'

import { anatomy, bundle } from '../../schema-studio/__tests__/fixture'
import { arrange } from '../scene/arrange'
import { neighbourhood } from '../scene/focus'
import { behaviorBundle } from './__tests__/behavior-fixture'
import { projectBehavior } from './behavior'
import { openBlocker, projectViews, viewsOf, viewsReaching } from './views'

const DOMAIN = 'local.example.dev'

const read = (facts: Partial<ViewReachRead> = {}): ViewReachRead => ({
  status: 'read',
  scope: 'view',
  sharedWith: [],
  entries: ['frontend/main.tsx'],
  files: 3,
  calls: [],
  definitions: [],
  reads: [],
  ownDefinitions: [],
  gaps: [],
  ...facts,
})

/** A Domain declaring `views`, read with its sources' `served` Views and client `routes`. */
function domain(
  views: Record<string, string | undefined>,
  served: ViewInfo[],
  extra: { entrypoint?: string; routes?: string[]; spans?: Record<string, string> } = {},
) {
  const value = bundle(
    {},
    {
      ...(extra.entrypoint === undefined
        ? {}
        : { schemaRoot: { entrypoint: { origin: DOMAIN, kind: 'view', name: extra.entrypoint } } }),
    },
  )
  value.ir!.views = Object.fromEntries(
    Object.entries(views).map(([slug, description]) => [
      slug,
      { name: slug, ...(description === undefined ? {} : { description }) },
    ]),
  )
  for (const [slug, file] of Object.entries(extra.spans ?? {}))
    value.overlay.sourceSpans[`view.${slug}`] = { file, startLine: 4, endLine: 9 }
  // the server states what each View's code reaches; here, nothing, unless a test says
  const sources: DomainAnatomy = anatomy(
    served.map((view) => ('reach' in view ? view : { ...view, reach: read() })),
  )
  sources.client.routes = Object.fromEntries((extra.routes ?? []).map((route) => [route, route]))
  return { bundle: value, anatomy: sources }
}

const project = ({ bundle: value, anatomy: sources }: ReturnType<typeof domain>) =>
  projectViews(value, {}, undefined, sources)

describe('the Views lens draws every View the Domain declares as a card', () => {
  test('a card names the View, how it is built, where it mounts and what it says of itself', () => {
    const scene = project(
      domain({ board: 'The team board.' }, [
        { slug: 'board', kind: 'spa', mount: '/board', description: 'The team board.' },
      ]),
    )
    expect(scene.nodes).toEqual([
      expect.objectContaining({
        id: 'view.board',
        kind: 'view',
        shape: 'card',
        label: 'board',
        sublabel: '/board',
        tone: 'view',
        icon: { glyph: 'view' },
        note: 'The team board.',
      }),
    ])
    expect(scene.nodes[0]!.badges?.map((badge) => badge.label)).toEqual(['single-page app'])
    expect(scene.links).toEqual([])
    expect(scene.empty).toBeUndefined()
  })

  test('the entrypoint leads and is marked; the others keep the Schema’s order', () => {
    const scene = project(
      domain(
        { alpha: undefined, board: undefined, inbox: undefined },
        [
          { slug: 'alpha', kind: 'inline-html' },
          { slug: 'board', kind: 'spa', mount: '/board' },
          { slug: 'inbox', kind: 'spa', mount: '/inbox' },
        ],
        { entrypoint: 'inbox', routes: ['/board', '/inbox'] },
      ),
    )
    expect(scene.nodes.map((node) => node.id)).toEqual(['view.inbox', 'view.alpha', 'view.board'])
    expect(scene.nodes[0]!.badges?.[0]).toMatchObject({ label: 'entrypoint', tone: 'view' })
    expect(scene.nodes[1]!.badges?.map((badge) => badge.label)).toEqual(['inline HTML'])
  })

  test('another Domain’s entrypoint marks none of this Domain’s Views', () => {
    const value = domain({ inbox: undefined }, [{ slug: 'inbox', kind: 'spa', mount: '/inbox' }], {
      routes: ['/inbox'],
    })
    value.bundle.schemaRoot = {
      entrypoint: { origin: 'other.example.dev', kind: 'view', name: 'inbox' },
    }
    expect(viewsOf(value.bundle, value.anatomy)[0]!.entrypoint).toBe(false)
  })

  test('a View its sources do not serve, or whose mount no client route serves, says so', () => {
    const value = domain(
      { lost: undefined, board: undefined },
      [{ slug: 'board', kind: 'spa', mount: '/board' }],
      { routes: ['/elsewhere'] },
    )
    // a declared View is in the IR, so the client route is not what backs it
    delete value.bundle.ir!.views.board
    const scene = project(value)
    const badges = (id: string) =>
      scene.nodes.find((node) => node.id === id)?.badges?.map((badge) => badge.label)
    expect(badges('view.lost')).toEqual(['no code found'])
    expect(badges('view.board')).toEqual(['single-page app', 'no client route'])
    expect(scene.nodes.find((node) => node.id === 'view.board')!.badges![1]).toMatchObject({
      tone: 'warning',
      title: 'It mounts at /board, which no route of the client serves',
    })
  })

  test('a client route no View mounts is counted and named, not drawn', () => {
    const scene = project(
      domain({ board: undefined }, [{ slug: 'board', kind: 'spa', mount: '/board' }], {
        routes: ['/board', '/stray'],
      }),
    )
    expect(scene.nodes.map((node) => node.id)).toEqual(['view.board'])
    expect(scene.folded).toEqual([
      { label: 'Client route without a View', count: 1, reason: 'no View mounts /stray' },
    ])
  })

  test('Views in more than one module are framed by module; in one, they stand unframed', () => {
    const spread = project(
      domain(
        { board: undefined, inbox: undefined },
        [
          { slug: 'board', kind: 'spa', mount: '/board' },
          { slug: 'inbox', kind: 'spa', mount: '/inbox' },
        ],
        {
          routes: ['/board', '/inbox'],
          spans: {
            board: 'schema/modules/planning/views.ts',
            inbox: 'schema/modules/support/views.ts',
          },
        },
      ),
    )
    expect(spread.nodes.map((node) => node.group)).toEqual([
      'module.modules/planning',
      'module.modules/support',
    ])
    expect(spread.groups.map((group) => group.caption)).toEqual(['1 View', '1 View'])

    const together = project(
      domain({ board: undefined }, [{ slug: 'board', kind: 'spa', mount: '/board' }], {
        routes: ['/board'],
        spans: { board: 'schema/modules/planning/views.ts' },
      }),
    )
    expect(together.groups).toEqual([])
    expect(together.nodes[0]!.group).toBeUndefined()
  })

  test('where the Schema declares a View is read from its span', () => {
    const value = domain({ board: undefined }, [{ slug: 'board', kind: 'spa', mount: '/board' }], {
      routes: ['/board'],
      spans: { board: 'schema/views.ts' },
    })
    expect(viewsOf(value.bundle, value.anatomy)[0]!.declared).toEqual({
      file: 'schema/views.ts',
      line: 4,
    })
  })

  test('a Publication’s Views are declared only: no code, no drift', () => {
    const value = domain({ board: 'The team board.' }, [])
    value.bundle.domainId = publishedDomainId(DOMAIN, '1.2.0')
    const scene = project(value)
    expect(scene.nodes).toHaveLength(1)
    expect(scene.nodes[0]!.badges?.map((badge) => badge.label)).toEqual(['declared only'])
    expect(viewsOf(value.bundle, value.anatomy)[0]!.published).toBe(true)
  })

  test('a Domain with no View says so, a Publication in its own words', () => {
    expect(project(domain({}, [])).empty).toBe(
      'This Domain declares no View: nothing here is shown to people.',
    )
    const published = domain({}, [])
    published.bundle.domainId = publishedDomainId(DOMAIN, '1.2.0')
    expect(project(published).empty).toBe('The published Schema declares no View.')
  })

  test('the Scene changes key with what the sources say of a View', () => {
    const before = domain({ board: undefined }, [{ slug: 'board', kind: 'spa', mount: '/board' }])
    const after = domain({ board: undefined }, [{ slug: 'board', kind: 'spa', mount: '/b' }])
    expect(project(before).key).not.toBe(project(after).key)
    expect(project(before).key).toBe(project(before).key)
  })
})

describe('opening a View', () => {
  const instance = (input: Partial<InstanceInfo>): InstanceInfo => ({
    name: 'dev',
    url: 'https://dev.example.dev',
    active: true,
    kind: 'managed',
    owned: true,
    ...input,
  })

  test('opens on an active instance its user owns', () => {
    expect(openBlocker({ published: false }, [instance({})], null)).toBeUndefined()
  })

  test('says, in one sentence, why it cannot', () => {
    expect(openBlocker({ published: true }, [instance({})], null)).toBe(
      'A published bundle holds no View code, so it cannot open here.',
    )
    expect(openBlocker({ published: false }, undefined, null)).toBe('Reading the instances…')
    expect(openBlocker({ published: false }, [], null)).toBe(
      'Choose an instance you own to open it.',
    )
    expect(openBlocker({ published: false }, [instance({ active: false })], null)).toBe(
      'Choose an instance you own to open it.',
    )
    expect(openBlocker({ published: false }, [instance({ owned: false })], 'Not yours.')).toBe(
      'Not yours.',
    )
  })
})

describe('which Views reach a thing', () => {
  const value = (reaches: Record<string, ViewInfo['reach']>) => {
    const declared = Object.fromEntries(Object.keys(reaches).map((slug) => [slug, undefined]))
    const { bundle: schema, anatomy: sources } = domain(
      declared,
      Object.entries(reaches).map(([slug, reach]) => ({
        slug,
        kind: 'spa' as const,
        mount: `/${slug}`,
        reach,
      })),
      { routes: Object.keys(reaches).map((slug) => `/${slug}`) },
    )
    return viewsOf(schema, sources)
  }

  test('by the calls, reads and definitions read from each View’s code', () => {
    const views = value({
      board: read({ calls: [{ key: 'Task.close', sites: [{ file: 'f.tsx', line: 3 }] }] }),
      inbox: read({
        scope: 'frontend',
        sharedWith: ['board'],
        reads: [{ class: 'Task', definitions: [], sites: [] }],
        definitions: [{ kind: 'query', id: 'openTasks', sites: [] }],
      }),
    })
    const calls = viewsReaching(views, { kind: 'function', key: 'Task.close' }, DOMAIN)
    expect(calls.reaching.map(({ view, how }) => [view.slug, how])).toEqual([['board', 'calls']])
    expect(calls.untold).toEqual([])
    const reads = viewsReaching(views, { kind: 'class', origin: DOMAIN, name: 'Task' }, DOMAIN)
    expect(reads.reaching.map(({ view, how, shared }) => [view.slug, how, shared])).toEqual([
      ['inbox', 'reads', true],
    ])
    const uses = viewsReaching(
      views,
      { kind: 'definition', definition: 'query', id: 'openTasks' },
      DOMAIN,
    )
    expect(uses.reaching.map(({ how }) => how)).toEqual(['uses'])
  })

  test('a View whose code could not be read in full is untold, never said not to reach it', () => {
    const views = value({
      board: undefined,
      inbox: { status: 'unread', reason: 'Its entry module could not be found.' },
      gaps: read({ gaps: [{ file: 'f.tsx', line: 2, reason: 'A computed call.' }] }),
      none: { status: 'none', reason: 'No code serves it.' },
    })
    const { reaching, untold } = viewsReaching(views, { kind: 'function', key: 'close' }, DOMAIN)
    expect(reaching).toEqual([])
    expect(untold.map((view) => view.slug)).toEqual(['board', 'inbox', 'gaps'])
  })
})

describe('where the sources say what each View’s code reaches', () => {
  /** The Behavior fixture's Domain, declaring one View `board` whose code reaches `reach`. */
  const reaching = (reach: ViewInfo['reach'], options: { reads?: boolean } = {}) => {
    const value = behaviorBundle()
    value.ir!.views = { board: { name: 'board' } }
    const sources = anatomy([
      { slug: 'board', kind: 'spa', mount: '/board', ...(reach ? { reach } : {}) },
    ])
    sources.client.routes = { '/board': '/board' }
    return { scene: projectViews(value, options, undefined, sources), value }
  }
  const retireAndFleet = read({
    calls: [
      { key: 'Host.retire', sites: [{ file: 'frontend/board.tsx', line: 4 }] },
      { key: 'Nowhere.toBeFound', sites: [{ file: 'frontend/board.tsx', line: 9 }] },
    ],
    reads: [{ class: 'Fleet', definitions: [], sites: [{ file: 'frontend/board.tsx', line: 2 }] }],
  })

  test('the Views, the functions they call and the Classes read in three bands', () => {
    const { scene } = reaching(retireAndFleet, { reads: true })
    expect(scene.bands?.map((band) => band.label)).toEqual(['Views', 'Functions', 'Graph'])
    const columns = Object.fromEntries(scene.nodes.map((node) => [node.id, node.column]))
    expect(columns['view.board']).toBe(0)
    expect(columns['function.Host.retire']).toBe(1)
    expect(columns['class.Fleet']).toBe(2)
    expect(scene.nodes.every((node) => node.column !== undefined)).toBe(true)
    // a call the Schema declares no function for is the View page's to name
    expect(scene.nodes.some((node) => node.id.includes('Nowhere'))).toBe(false)
  })

  test('a function is a step between a View and the graph, under its Behavior id', () => {
    const { scene, value } = reaching(retireAndFleet, { reads: true })
    expect(scene.nodes.find((node) => node.id === 'function.Host.retire')).toMatchObject({
      kind: 'function',
      shape: 'pill',
      label: 'retire',
      sublabel: 'Host',
      anchor: 'class.Host.method.retire',
      tone: 'fn',
    })
    expect(scene.links.find((link) => link.id === 'calls:view.board:function.Host.retire')).toEqual(
      expect.objectContaining({ label: 'calls', opens: 'function.Host.retire', tone: 'call' }),
    )
    expect(scene.links.find((link) => link.id === 'read:view.board:class.Fleet')).toEqual(
      expect.objectContaining({ label: 'reads', dashed: true }),
    )
    // what the function changes reads as Behavior says it, verb by verb, on the same Classes
    const changes = (links: Scene['links']) =>
      links
        .filter((link) => link.kind === 'change' && link.from.nodes[0] === 'function.Host.retire')
        .map((link) => `${link.label} → ${link.to.nodes.join(',')}`)
        .sort()
    const behavior = projectBehavior(value, {})
    expect(changes(scene.links)).toEqual(changes(behavior.links))
    expect(changes(scene.links).length).toBeGreaterThan(0)
    for (const link of scene.links)
      for (const node of [...link.from.nodes, ...link.to.nodes])
        expect(scene.nodes.some((one) => one.id === node)).toBe(true)
  })

  test('lighting a View lights through its functions to what they change', () => {
    const { scene } = reaching(retireAndFleet, { reads: true })
    const lit = neighbourhood(scene, arrange(scene, { collapsed: new Set() }), 'view.board')!
    expect(lit.links.has('calls:view.board:function.Host.retire')).toBe(true)
    expect(lit.links.has('read:view.board:class.Fleet')).toBe(true)
    expect(
      scene.links.filter((link) => link.kind === 'change').every((link) => lit.links.has(link.id)),
    ).toBe(true)
  })

  test('the Index lists the Views, then the functions and the Classes, as the bands read', () => {
    const { scene } = reaching(retireAndFleet, { reads: true })
    expect(scene.index?.groups.map((group) => group.label)).toEqual(['Views', 'Functions', 'Graph'])
    const entry = (id: string) => scene.index?.entries.find((one) => one.id === id)?.group
    expect(entry('view.board')).toBe('index.views')
    expect(entry('function.Host.retire')).toBe('index.functions')
    expect(entry('class.Fleet')).toBe('index.graph')
  })

  test('what a View reads is drawn with the `reads` option, as Behavior draws a function’s', () => {
    const { scene } = reaching(retireAndFleet)
    expect(scene.links.some((link) => link.kind === 'read')).toBe(false)
    expect(scene.nodes.some((node) => node.id === 'function.Host.retire')).toBe(true)
    const readsOnly = read({ reads: [{ class: 'Fleet', definitions: [], sites: [] }] })
    expect(reaching(readsOnly).scene.nodes.map((node) => node.id)).toEqual(['view.board'])
    expect(reaching(readsOnly, { reads: true }).scene.links.map((link) => link.id)).toEqual([
      'read:view.board:class.Fleet',
    ])
  })

  test('code that reaches nothing, or is not read, draws the Views alone', () => {
    for (const reach of [read(), undefined, { status: 'none' as const, reason: 'No code.' }]) {
      const { scene } = reaching(reach)
      expect(scene.nodes.map((node) => node.id)).toEqual(['view.board'])
      expect(scene.bands).toBeUndefined()
      expect(scene.index).toBeUndefined()
      expect(scene.nodes[0]!.column).toBeUndefined()
    }
  })

  test('a View whose code cannot be told in full says so on its card', () => {
    const badge = (reach: ViewInfo['reach']) =>
      reaching(reach).scene.nodes[0]!.badges?.find((one) => one.label === 'can’t tell')
    expect(badge({ status: 'unread', reason: 'Its entry module could not be found.' })).toEqual({
      label: 'can’t tell',
      tone: 'warning',
      title: 'Its entry module could not be found.',
    })
    expect(
      badge(read({ gaps: [{ file: 'frontend/board.tsx', line: 7, reason: 'A computed call.' }] }))
        ?.title,
    ).toBe('frontend/board.tsx:7: A computed call.')
    expect(badge(read())).toBeUndefined()
    // what the server does not send is not known either
    expect(badge(undefined)?.title).toBe('The server sent no reading of this View’s code.')
  })

  test('the Scene changes key with what the code reaches', () => {
    const before = reaching(read({ calls: [{ key: 'Host.retire', sites: [] }] })).scene
    const after = reaching(read({ calls: [{ key: 'Host.create', sites: [] }] })).scene
    expect(before.key).not.toBe(after.key)
  })
})
