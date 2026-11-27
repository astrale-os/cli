import { expect, test } from 'bun:test'

import {
  anchorData,
  anchorKindForRef,
  domainAnchorRef,
  detailRefFor,
  locateTarget,
  parseMemberFieldRef,
  targetAt,
  targetOwnerOf,
  targetSurface,
} from './targets'

/**
 * Just enough of the DOM for target location, so these rules run without a browser: elements
 * with attributes, a tree, and the attribute-presence selectors (`[data-x]`) the rules use. Any
 * other selector throws, so the rules cannot quietly depend on one.
 */
class Fake {
  parent: Fake | null = null
  readonly children: Fake[] = []
  constructor(
    private readonly attributes: Record<string, string | undefined> = {},
    private readonly text = '',
    private readonly page = false,
  ) {}

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('')
  }

  static page(...children: Fake[]): Fake {
    return new Fake({}, '', true).append(...children)
  }

  append(...children: Fake[]): Fake {
    for (const child of children) {
      child.parent = this
      this.children.push(child)
    }
    return this
  }

  remove(): void {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1)
    this.parent = null
  }

  get isConnected(): boolean {
    let top: Fake = this
    while (top.parent) top = top.parent
    return top.page
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }

  closest(selector: string): Fake | null {
    const name = attributeOf(selector)
    for (let at: Fake | null = this; at; at = at.parent)
      if (at.getAttribute(name) !== null) return at
    return null
  }

  querySelectorAll(selector: string): Fake[] {
    const name = attributeOf(selector)
    const found: Fake[] = []
    const visit = (at: Fake) => {
      for (const child of at.children) {
        if (child.getAttribute(name) !== null) found.push(child)
        visit(child)
      }
    }
    visit(this)
    return found
  }

  get dom(): Element {
    return this as unknown as Element
  }
}

function attributeOf(selector: string): string {
  const match = /^\[([\w-]+)\]$/.exec(selector)
  if (!match) throw new Error(`the fake DOM reads attribute selectors only: ${selector}`)
  return match[1]!
}

/** A part stamped as a target, as `anchorData` stamps it. */
function part(ref: string, excerpt: string, domainId?: string): Fake {
  const stamps = anchorData(ref, excerpt, domainId)
  return new Fake({ ...stamps }, excerpt)
}

/** A surface root: its `targetSurface` stamp, and the Domain it draws, if it draws one. */
function surface(name: Parameters<typeof targetSurface>[0], domainId?: string): Fake {
  return new Fake({ ...targetSurface(name), 'data-domain-id': domainId })
}

test('a member field ref splits from the member that owns it, whose detail it opens', () => {
  expect(parseMemberFieldRef('class.Code.property.total')).toEqual({
    owner: 'class.Code',
    kind: 'property',
    name: 'total',
  })
  expect(parseMemberFieldRef('edge.assigned_to.endpoint.owner')).toEqual({
    owner: 'edge.assigned_to',
    kind: 'endpoint',
    name: 'owner',
  })
  // an imported Class carries its origin key, dots and all, before the field segment
  expect(parseMemberFieldRef('class.docs.example.dev:class.Document.method.publish')).toEqual({
    owner: 'class.docs.example.dev:class.Document',
    kind: 'method',
    name: 'publish',
  })
  // only a field resolves to a different detail view
  expect(detailRefFor('class.Code.property.total')).toBe('class.Code')
  expect(detailRefFor('class.Code')).toBe('class.Code')
  expect(parseMemberFieldRef('section.schema')).toBeNull()
})

test('a domain is a scope in the target hierarchy, keyed by origin', () => {
  const ref = domainAnchorRef('crm.studio-demo.astrale.ai')
  expect(ref).toBe('domain.crm.studio-demo.astrale.ai')
  // a scope, like a module or a section — not a schema member
  expect(anchorKindForRef(ref)).toBe('section')
  expect(anchorKindForRef('module.billing')).toBe('section')
  expect(anchorKindForRef('class.Order')).toBe('schema')
  expect(anchorKindForRef('function.createOrder')).toBe('schema')
  expect(anchorKindForRef('core.node./:orders.example.dev:core.root')).toBe('section')
  expect(anchorKindForRef('integration.request.stripe')).toBe('section')
  // the whole domain IS the target — nothing coarser contains it
  expect(detailRefFor(ref)).toBe(ref)
  // dots in an origin are not field separators
  expect(parseMemberFieldRef(ref)).toBeNull()
})

test('an anchor can name the domain whose threads it belongs to', () => {
  // The rail lists domains the canvas may not draw, so there is no `data-domain-id`
  // around its rows to fall back on — the owner has to ride on the anchor.
  expect(anchorData('domain.ops.example.dev', 'ops.example.dev', 'peer')).toEqual({
    'data-anchor-ref': 'domain.ops.example.dev',
    'data-anchor-excerpt': 'ops.example.dev',
    'data-anchor-domain-id': 'peer',
    'data-commentable': '',
  })
  // left out where the surface already sits inside the domain it belongs to
  expect(anchorData('class.Order', 'Order')['data-anchor-domain-id']).toBeUndefined()
})

test('a target is found where it was made, never at a namesake on another surface', () => {
  // The Index lists the Class before the canvas draws it: page order must not decide.
  const row = part('class.Company', 'Company', 'ops')
  const card = part('class.Company', 'Company')
  const label = new Fake({}, 'Company')
  card.append(label)
  const page = Fake.page(surface('index').append(row), surface('canvas', 'ops').append(card))

  const onCard = targetAt(label.dom)!
  expect(onCard).toMatchObject({
    domainId: 'ops',
    anchor: { ref: 'class.Company', kind: 'schema' },
    excerpt: 'Company',
    surface: 'canvas',
  })
  expect(onCard.element).toBe(card.dom)
  expect(locateTarget(page.dom, onCard)).toBe(card.dom)

  const onRow = targetAt(row.dom)!
  expect(onRow.surface).toBe('index')
  expect(locateTarget(page.dom, onRow)).toBe(row.dom)
})

test('a redrawn target is found again on its surface, in its own Domain', () => {
  const peerCard = part('class.Company', 'Company')
  const ownCard = part('class.Company', 'Company')
  const own = surface('canvas', 'crm').append(ownCard)
  const page = Fake.page(
    surface('index').append(part('class.Company', 'Company', 'ops')),
    surface('canvas', 'ops').append(peerCard),
    own,
  )
  const made = targetAt(peerCard.dom)!

  // the card it was made on leaves the page; the one that takes its place is the target
  peerCard.remove()
  expect(locateTarget(page.dom, made)).toBeNull()
  const redrawn = part('class.Company', 'Company')
  page.children[1]!.append(redrawn)
  expect(locateTarget(page.dom, made)).toBe(redrawn.dom)
  // the same ref in another Domain is another target
  expect(targetAt(ownCard.dom)!.domainId).toBe('crm')
  expect(locateTarget(page.dom, targetAt(ownCard.dom)!)).toBe(ownCard.dom)
})

test('a target belongs to the owner stamped on it, else to the Domain drawn around it', () => {
  const stamped = part('domain.payments.example.dev', 'payments', 'peer')
  const framed = part('domain.payments.example.dev', 'payments')
  const loose = part('class.Order', 'Order')
  Fake.page(surface('canvas', 'crm').append(stamped, framed), surface('inspector').append(loose))

  expect(targetOwnerOf(stamped.dom)).toBe('peer')
  expect(targetOwnerOf(framed.dom)).toBe('crm')
  // nothing names the Domain of an element drawn outside any: it is no target
  expect(targetOwnerOf(loose.dom)).toBeUndefined()
  expect(targetAt(loose.dom)).toBeNull()
  // page chrome carries no stamp at all
  expect(targetAt(new Fake().dom)).toBeNull()
  expect(targetAt(null)).toBeNull()
})

test('the nearest stamp is the target, and its excerpt is short and trimmed', () => {
  const field = part('class.Order.property.total', '')
  const card = part('class.Order', 'Order').append(field)
  Fake.page(surface('canvas', 'crm').append(card))
  const inner = new Fake({}, `  ${'x'.repeat(100)}  `)
  field.append(inner)

  const target = targetAt(inner.dom)!
  expect(target.anchor).toEqual({ ref: 'class.Order.property.total', kind: 'schema' })
  // an empty excerpt stamp falls back to the element's text
  expect(target.excerpt).toBe('x'.repeat(80))
})
