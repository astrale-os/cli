/**
 * A Domain's rules in the Inspector: each one read by `@astrale-os/visual` in the Studio's ink
 * (`rules.css`), or why it cannot be. The words, the Figure, the notation and the cast are the
 * reader's; the Studio only places them, groups them, opens what they name, and says what the
 * Kernel admits where the Schema writes nothing or a constant (`kernelDefaultOf`).
 */
import type { Rule, Selection } from '@astrale-os/visual'

import { Cast, FocusedWordCard, Notation, Reading, RuleScope } from '@astrale-os/visual/react'
import { type ReactNode, useCallback, useState } from 'react'

import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { TONE_TEXT } from '../canvas/tones'
import { Disclosure, Empty, Joined, Link, Meta, Section } from '../inspector/parts'
import { Staged } from '../stage/staged'
import { RuleStage } from '../stage/walk-stage'
import { admissionLabel, markOf } from './admission'
import {
  callRuleOf,
  classOfTarget,
  type DomainRules,
  kernelDefaultOf,
  type PolicyRule,
  type RuleName,
  type RuleSite,
  ruleView,
  sitesOn,
  type Unread,
  type UnreadReason,
} from './model'
import { RuleMark } from './rule-mark'
import './rules.css'

/** The reader's scope around one rule, in English; what is pinned in it is that rule's alone. */
export function RuleHost({
  rule,
  className,
  children,
}: {
  rule: Rule
  className?: string
  children: ReactNode
}) {
  const [pinned, setPinned] = useState<{ rule: Rule; selection: Selection }>()
  const onSelectionChange = useCallback(
    (selection: Selection) => setPinned({ rule, selection }),
    [rule],
  )
  return (
    <RuleScope
      className={cn('studio-rules outline-none', className)}
      rule={rule}
      locale="en"
      selection={pinned?.rule === rule ? pinned.selection : undefined}
      onSelectionChange={onSelectionChange}
    >
      {children}
    </RuleScope>
  )
}

const UNREAD: Record<UnreadReason, string> = {
  'not-admitted': 'no admitted Schema',
  'no-closure': 'its dependencies were not sent',
  'missing-policy': 'its Policy is not found',
  refused: 'the reader refused it',
  'not-expressible': 'no rule form says it',
  unchecked: 'nothing checks it',
  foreign: 'it is another Domain’s',
  'not-enumerated': 'no use is enumerated',
}

/** Why a rule has no reading: the reason, then the reader's or the model's detail. */
export function UnreadNote({ unread, className }: { unread: Unread; className?: string }) {
  return (
    <div data-rule-unread={unread.reason} className={cn('text-[12px] leading-relaxed', className)}>
      <span className="font-medium text-warning">Not read: {UNREAD[unread.reason]}.</span>{' '}
      <span className="text-muted-foreground">{unread.detail}</span>
    </div>
  )
}

/** A Policy key's name: `<origin>:policy.<Name>` reads as `<Name>`. */
const policyName = (key: string) => key.slice(key.indexOf(':policy.') + ':policy.'.length)

/** Policies as links that open them, those named directly first. */
function PolicyLinks({ policies, domainId }: { policies: RuleSite['policies']; domainId: string }) {
  return (
    <Joined
      limit={8}
      items={policies.map(({ key, direct }) => (
        <Link
          key={key}
          target={`policy.${key}`}
          domainId={domainId}
          mono
          title={direct ? `Open ${key}` : `Open ${key}, checked through another Policy`}
        >
          {policyName(key)}
        </Link>
      ))}
    />
  )
}

/** A Domain's short name (`admin.astrale.ai` → `admin`), as the Inspector says Domains. */
const domainWord = (origin: string | undefined) =>
  origin === undefined
    ? 'this Domain'
    : origin === 'kernel.astrale.ai'
      ? 'kernel'
      : origin.split('.')[0]!

/**
 * What a rule names, as a sentence of links: its Classes with those that extend them folded
 * into a count, every node at once, the relationships it follows, the Core Nodes it names.
 */
export function RuleNames({ rule, domainId }: { rule: Rule; domainId: string }) {
  const { names } = ruleView(rule)
  if (names.length === 0) return null
  const origin = rule.catalogue.origin
  const one = (name: RuleName) => {
    switch (name.kind) {
      case 'class': {
        const { name: shown, origin: from } = classOfTarget(name.target)
        return (
          <span key={name.key}>
            <Link target={name.target} domainId={domainId}>
              {shown}
            </Link>
            {from !== undefined && from !== origin && (
              <span className="text-muted-foreground"> ({domainWord(from)})</span>
            )}
            {name.folded > 0 && (
              <span className="text-muted-foreground">
                {' '}
                and the {name.folded} {name.folded === 1 ? 'Class' : 'Classes'} that extend it
              </span>
            )}
          </span>
        )
      }
      case 'every':
        return (
          <span key={`every:${name.origin ?? ''}`}>
            any node{name.origin === undefined ? '' : ` of ${domainWord(name.origin)}`}
            <span className="text-muted-foreground"> ({name.count} Classes)</span>
          </span>
        )
      case 'relationship':
        return (
          <Link key={name.key} target={name.target} domainId={domainId} mono>
            {classOfTarget(name.target).name}
          </Link>
        )
      case 'node':
        return (
          <span key={name.path} title={name.path}>
            the <span className="font-mono text-[0.92em]">{name.name}</span>
            {name.classes.length > 0 && (
              <>
                {' '}
                <Joined
                  last="or"
                  items={name.classes.map((each) => (
                    <Link key={each.key} target={each.target} domainId={domainId}>
                      {classOfTarget(each.target).name}
                    </Link>
                  ))}
                />
              </>
            )}
            <span className="text-muted-foreground">
              {' '}
              of {domainWord(name.path.slice(0, name.path.indexOf(':')))}
            </span>
          </span>
        )
    }
  }
  return (
    <p data-rule-names="" className="text-[12px] leading-relaxed">
      <span className="text-muted-foreground">Names </span>
      <Joined items={names.map(one)} />
    </p>
  )
}

/** The rule's notation and cast: what a reader who wants the formal shape opens. */
function Formal({
  rule,
  domainId,
  through,
}: {
  rule: Rule
  domainId: string
  through: RuleSite['policies']
}) {
  return (
    <div className="space-y-2.5">
      <RuleNames rule={rule} domainId={domainId} />
      {through.length > 0 && (
        <p className="text-[12px] leading-relaxed">
          <span className="text-muted-foreground">Through </span>
          <PolicyLinks policies={through} domainId={domainId} />
        </p>
      )}
      <div className="text-[12px]">
        <Cast />
      </div>
      <div className="overflow-x-auto rounded-md bg-muted/60 px-3 py-2 text-[12px]">
        <Notation />
      </div>
    </div>
  )
}

const SLOT_WORD: Record<string, string> = {
  read: 'Read',
  traverse: 'Traverse',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  call: 'Call',
}

/**
 * One site: what it decides (a slot, or a constraint's declaration), its reading in the
 * reader's words — or, where the Schema writes nothing or a constant, what the Kernel admits —
 * the Policies it names, and on demand its notation, cast and what it names.
 */
function SiteRow({ site, domain, domainId }: { site: RuleSite; domain: string; domainId: string }) {
  const { reading } = site
  const named = site.policies.filter((policy) => policy.direct)
  const through = site.policies.filter((policy) => !policy.direct)
  const kernel = kernelDefaultOf(site, domain)
  const label = site.kind === 'what' ? undefined : (SLOT_WORD[site.slot] ?? site.slot)
  const mark = markOf(site)
  const body = (
    <>
      {kernel !== undefined ? (
        <p data-rule-kernel="" title={kernel} className="text-[13px] text-muted-foreground">
          {mark ? admissionLabel(mark.admits) : kernel}
        </p>
      ) : reading.status === 'unread' ? (
        <UnreadNote unread={reading} />
      ) : (
        <div className="text-[13px] leading-relaxed">
          <Reading />
        </div>
      )}
      {site.kind === 'what' && <Meta className="font-mono text-[11.5px]">{site.title}</Meta>}
      {site.written === 'true' && <Meta>Written true.</Meta>}
      {named.length > 0 && (
        <Meta data-rule-policies="">
          Checks <PolicyLinks policies={named} domainId={domainId} />
        </Meta>
      )}
      {kernel === undefined && reading.status === 'read' && (
        <Disclosure label="What it names, its cast and notation">
          <Formal rule={reading.rule} domainId={domainId} through={through} />
        </Disclosure>
      )}
    </>
  )
  const layout = (
    <div data-rule-site={site.id} className="flex gap-3 py-2.5">
      {label !== undefined && (
        <span
          data-rule-op={mark?.op}
          className={cn(
            'flex w-[5.75rem] shrink-0 items-center gap-1.5 pt-0.5 text-[12px] font-medium',
            mark ? TONE_TEXT[mark.op] : 'text-muted-foreground',
          )}
        >
          {mark && <RuleMark mark={mark} />}
          {label}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1.5">{body}</div>
    </div>
  )
  if (kernel !== undefined || reading.status === 'unread') return layout
  return (
    <RuleHost rule={reading.rule} className="studio-rules-row block">
      {layout}
      <FocusedWordCard />
    </RuleHost>
  )
}

/**
 * Sites as rows, then whom “you” stands for in their words, each different sentence once: the
 * reader ends each reading that departs from the convention on it, and a list says it once.
 */
function SiteList({
  sites,
  domain,
  domainId,
}: {
  sites: readonly RuleSite[]
  domain: string
  domainId: string
}) {
  const notes = [
    ...new Set(
      sites.flatMap((site) =>
        site.reading.status === 'read' && kernelDefaultOf(site, domain) === undefined
          ? [ruleView(site.reading.rule).you].filter((you): you is string => you !== undefined)
          : [],
      ),
    ),
  ]
  return (
    <div>
      <div className="divide-y divide-border/60">
        {sites.map((site) => (
          <SiteRow key={site.id} site={site} domain={domain} domainId={domainId} />
        ))}
      </div>
      {notes.map((note) => (
        <p
          key={note}
          data-rule-you=""
          className="pt-1 text-[12px] leading-relaxed text-muted-foreground"
        >
          {note}
        </p>
      ))}
    </div>
  )
}

/**
 * The rules that sit on a Class or relationship (`class.X`, `edge.X`, or an imported
 * `class.<origin>:class.X`): its Policies, then its constraints — those that sit on
 * it, or `holds`, what its reader gathers there (a Class's card gathers its relationships'
 * constraints too), with how many. An imported one's rules are its own Domain's; a Domain with
 * no reading says why.
 */
export function RuleSites({
  rules,
  target,
  holds,
}: {
  rules: DomainRules
  target: string
  holds?: { count: number; body: ReactNode }
}) {
  if (rules.unread !== undefined)
    return (
      <Section label="Rules">
        <UnreadNote unread={rules.unread} />
      </Section>
    )
  const sites = sitesOn(rules, target)
  const { name, origin } = classOfTarget(target)
  const domain = domainWord(rules.origin)
  const who = sites.filter((site) => site.kind === 'who')
  const what = sites.filter((site) => site.kind === 'what')
  const held = holds ?? {
    count: what.length,
    body: <SiteList sites={what} domain={domain} domainId={rules.domainId} />,
  }
  if (who.length === 0 && held.count === 0)
    return (
      <Section label="Rules">
        {origin !== undefined && origin !== rules.origin ? (
          <Empty>Declared by {domainWord(origin)}: its rules are read there.</Empty>
        ) : (
          <Empty>No rule sits on {name}.</Empty>
        )}
      </Section>
    )
  return (
    <>
      {who.length > 0 && (
        <Section label="Policies" kind="policies" data-rule-group="who">
          <SiteList sites={who} domain={domain} domainId={rules.domainId} />
        </Section>
      )}
      <Section
        label="Constraints"
        kind="constraints"
        count={held.count || undefined}
        data-rule-group="what"
      >
        {held.count > 0 ? held.body : <Empty>The Schema declares no constraint on {name}.</Empty>}
      </Section>
    </>
  )
}

/**
 * Who may call a Method (`class.X.method.m`) or a function (`function.f`): its call rule read,
 * what the Kernel admits where no Policy or `false` is written, or why it is not read. A
 * callable open to anyone or to any signed-in caller has none to show.
 */
export function CallRule({
  rules,
  target,
  auth,
  contract = false,
}: {
  rules: DomainRules
  target: string
  auth: 'anonymous' | 'authenticated' | 'authorized' | undefined
  /** An abstract contract, whose implementations declare its Policy. */
  contract?: boolean
}) {
  const site = callRuleOf(rules, target, auth, contract)
  if (site === undefined) return null
  const { reading } = site
  const kernel = kernelDefaultOf(site, domainWord(rules.origin))
  if (kernel !== undefined && (reading.status === 'read' || site.written === 'false')) {
    const mark = markOf(site)
    return (
      <p
        data-rule-site={site.id}
        data-rule-kernel=""
        title={kernel}
        className="text-[13px] text-muted-foreground"
      >
        {mark ? admissionLabel(mark.admits) : kernel}
      </p>
    )
  }
  if (reading.status === 'unread') return <UnreadNote unread={reading} />
  return (
    <RuleHost rule={reading.rule} className="block">
      <div data-rule-site={site.id} className="space-y-2">
        <div className="text-[13px] leading-relaxed">
          <Reading />
        </div>
        {site.written === 'true' && <Meta>Written true.</Meta>}
        {site.policies.some((policy) => policy.direct) && (
          <Meta data-rule-policies="">
            Checks{' '}
            <PolicyLinks
              policies={site.policies.filter((policy) => policy.direct)}
              domainId={rules.domainId}
            />
          </Meta>
        )}
        <Disclosure label="What it names, its cast and notation">
          <Formal
            rule={reading.rule}
            domainId={rules.domainId}
            through={site.policies.filter((policy) => !policy.direct)}
          />
        </Disclosure>
      </div>
      <FocusedWordCard />
    </RuleHost>
  )
}

/** A site as a Policy's "sits on" names it: `Comment · read`, `Comment.edit`, `createIssue`. */
function siteLabel(site: RuleSite): string {
  const { on } = site
  switch (on.kind) {
    case 'class':
    case 'relationship':
      return `${on.name} · ${site.slot}`
    case 'method':
      return `${on.owner}.${on.name}`
    case 'function':
      return on.name
    case 'schema':
      return site.title
  }
}

/**
 * A place of the rule selected, said by its name. At the Schema level the map draws it, so a
 * click brings it into view and the rule stays selected — as the canvas's edge does for a place
 * past it; elsewhere it opens what it names.
 */
function PlaceLink({
  site,
  target,
  domainId,
  mono = false,
  children,
}: {
  site: string
  target: string
  domainId: string
  mono?: boolean
  children: ReactNode
}) {
  const onMap = useUI((state) => state.level === 'domain')
  if (!onMap)
    return (
      <Link target={target} domainId={domainId} mono={mono}>
        {children}
      </Link>
    )
  return (
    <button
      type="button"
      data-place-jump={site}
      title="Show this place on the map"
      onClick={(event) => {
        event.stopPropagation()
        useUI.getState().revealOnCanvas(site)
      }}
      className={cn(
        'inline rounded-sm text-left underline decoration-foreground/20 underline-offset-[3px] transition-colors hover:decoration-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
        mono ? 'font-mono text-[0.92em]' : 'font-medium',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The sites whose rule checks a Policy, those that name it first, as links to their places on
 * the map.
 */
export function SitsOn({ rules, policy }: { rules: DomainRules; policy: PolicyRule }) {
  const byId = new Map(rules.sites.map((site) => [site.id, site]))
  const sitsOn = (direct: boolean) =>
    policy.sitsOn
      .filter((each) => each.direct === direct)
      .map((each) => byId.get(each.site))
      .filter((site): site is RuleSite => site !== undefined)
  const named = sitsOn(true)
  const through = sitsOn(false)
  // the slots of one Class or relationship are said together: `Fleet (read, traverse)`
  const links = (sites: readonly RuleSite[]) => {
    const groups = new Map<string, RuleSite[]>()
    for (const site of sites) {
      const key =
        site.on.kind === 'class' || site.on.kind === 'relationship' ? site.on.target : site.id
      groups.set(key, [...(groups.get(key) ?? []), site])
    }
    return (
      <Joined
        limit={8}
        items={[...groups.values()].map((group) => {
          const site = group[0]!
          const { on } = site
          if (on.kind !== 'class' && on.kind !== 'relationship')
            return (
              <PlaceLink
                key={site.id}
                site={site.id}
                target={on.target}
                domainId={rules.domainId}
                mono
              >
                {siteLabel(site)}
              </PlaceLink>
            )
          return (
            <span key={site.id}>
              <PlaceLink
                site={site.id}
                target={on.target}
                domainId={rules.domainId}
                mono={on.kind === 'relationship'}
              >
                {on.name}
              </PlaceLink>
              <span className="text-muted-foreground">
                {' '}
                ({group.map((each) => each.slot).join(', ')})
              </span>
            </span>
          )
        })}
      />
    )
  }
  return (
    <Section label="Sits on" count={named.length + through.length || undefined}>
      {named.length + through.length === 0 ? (
        <Empty>No slot, Method or function checks it.</Empty>
      ) : (
        <div data-policy-sits-on="" className="space-y-1.5 text-[13px] leading-relaxed">
          {named.length > 0 && <p>{links(named)}</p>}
          {through.length > 0 && (
            <p>
              <span className="text-muted-foreground">Through another Policy: </span>
              {links(through)}
            </p>
          )}
        </div>
      )}
    </Section>
  )
}

/**
 * A Policy's card: its rule in words, with its cast, what it names and its notation, its walk
 * step by step beside its Figure on the stage under the canvas; then the sites whose rule checks
 * it, those that name it first; the Policies its definition checks; and the Policies whose
 * definition checks it.
 */
export function PolicyRuleCard({ rules, policy }: { rules: DomainRules; policy: PolicyRule }) {
  const checksNamed = policy.policies.filter((each) => each.direct)
  const checksThrough = policy.policies.filter((each) => !each.direct)
  const { reading } = policy
  return (
    <>
      {reading.status === 'unread' ? (
        <Section label="Rule">
          <UnreadNote unread={reading} />
        </Section>
      ) : (
        <RuleHost rule={reading.rule} className="block space-y-8">
          <Section label="Rule" data-policy-rule="">
            <div className="text-[14px] leading-relaxed">
              <Reading />
            </div>
            <div className="text-[12px]">
              <Cast />
            </div>
            <RuleNames rule={reading.rule} domainId={rules.domainId} />
          </Section>
          <Staged label="Show the walk and its Figure">
            <RuleStage title={policy.name} tone="who" />
          </Staged>
          <Section label="Notation">
            <div className="overflow-x-auto rounded-md bg-muted/60 px-3 py-2 text-[12px]">
              <Notation />
            </div>
          </Section>
          <FocusedWordCard footer="Click pins its scope · ↑ ↓ widen, narrow · Esc clears" />
        </RuleHost>
      )}
      <SitsOn rules={rules} policy={policy} />
      {policy.policies.length > 0 && (
        <Section label="Checks" count={policy.policies.length}>
          <div data-policy-checks="" className="space-y-1.5 text-[13px] leading-relaxed">
            {checksNamed.length > 0 && (
              <p>
                <PolicyLinks policies={checksNamed} domainId={rules.domainId} />
              </p>
            )}
            {checksThrough.length > 0 && (
              <p>
                <span className="text-muted-foreground">Through another Policy: </span>
                <PolicyLinks policies={checksThrough} domainId={rules.domainId} />
              </p>
            )}
          </div>
        </Section>
      )}
      {policy.partOf.length > 0 && (
        <Section label="Part of" count={policy.partOf.length}>
          <p data-policy-part-of="" className="text-[13px] leading-relaxed">
            <PolicyLinks
              policies={policy.partOf.map((key) => ({ key, direct: true }))}
              domainId={rules.domainId}
            />
          </p>
        </Section>
      )}
    </>
  )
}
