/**
 * A rule's page, for what the Rules map selects that is no Class or function: one rule site
 * (`class.Host#read`, `class.X.method.m#call`) read as a sentence, where it sits and its
 * notation, with its walk step by step beside its Figure on the stage under the canvas, numbered
 * as the map numbers it; a row that holds several rules (`class.X#call`, `class.X#holds`, the
 * Domain functions card) as those rules, each read; a form of constraint (`constraint.no-self`)
 * as every place it sits. Where the Schema writes nothing, the page says what the Kernel admits
 * instead.
 */
import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { Cast, FocusedWordCard, Notation, Reading } from '@astrale-os/visual/react'
import {
  Blocks,
  Crown,
  Globe,
  KeyRound,
  type LucideIcon,
  ShieldCheck,
  UserCheck,
} from 'lucide-react'

import type { SceneRule, SceneRuleName } from './scene/types'

import { Empty, Fact, Link, Meta, Page, Section, Title } from './inspector/parts'
import {
  constraintFormOf,
  constraintSites,
  DOMAIN_FUNCTIONS,
  ruleFoldOf,
  ruleOwnerOf,
  ruleRowOf,
  ruleSiteOf,
} from './lenses/rules'
import { originShort } from './lenses/structure'
import { markOf, opOf } from './rules/admission'
import { classOfTarget, kernelDefaultOf, type RuleSite, rulesOf } from './rules/model'
import { Admission, ConstraintMark, RuleMark, RuleMarks } from './rules/rule-mark'
import { RuleHost, RuleNames, UnreadNote } from './rules/rule-view'
import { Staged } from './stage/staged'
import { RuleStage } from './stage/walk-stage'

/** Whether `id` opens a rule's page rather than a Class's, a function's or a Policy's. */
export function opensRulePage(id: string): boolean {
  return (
    (id.includes('#') && !id.endsWith('#none')) ||
    id.startsWith('constraint.') ||
    id === DOMAIN_FUNCTIONS
  )
}

/**
 * What a rule selection opens under a lens that draws no rule: the Class, Method or function
 * it sits on (`class.X.method.m#call` → `function.X.m`), else itself.
 */
export function ruleDetailOf(id: string): string {
  if (!id.includes('#')) return id
  const method = /^class\.([^.]+)\.method\.([^.#]+)#/.exec(id)
  if (method) return `function.${method[1]}.${method[2]}`
  const owner = ruleOwnerOf(id)
  return owner === DOMAIN_FUNCTIONS ? id.replace(/#.*$/, '') : owner
}

export function RulePage({ bundle, selected }: { bundle: StudioSchemaBundle; selected: string }) {
  const domain = bundle.ir ? originShort(bundle.ir.domain) : ''
  if (selected.startsWith('constraint.'))
    return <ConstraintPage bundle={bundle} id={selected} domain={domain} />
  const fold = ruleFoldOf(bundle, selected)
  if (fold) return <FoldPage bundle={bundle} fold={fold} domain={domain} />
  const site = ruleSiteOf(bundle, selected)
  if (site) return <SitePage bundle={bundle} site={site} domain={domain} />
  const row = ruleRowOf(bundle, selected)
  if (row) return <OpenCallPage bundle={bundle} row={row} />
  return (
    <Page domainId={bundle.domainId}>
      <Empty>{selected} is no rule of this Schema.</Empty>
    </Page>
  )
}

/** Slots in a list: `read`, `read or traverse`, `create, update or delete`. */
const listed = (words: readonly string[]) =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`

/** What a site sits on, as its page names it: `Host`, `Host.restart`, `createIssue`. */
function onName(site: RuleSite): string {
  const { on } = site
  if (on.kind === 'method') return `${on.owner}.${on.name}`
  return 'name' in on ? on.name : site.title
}

function SitePage({
  bundle,
  site,
  domain,
}: {
  bundle: StudioSchemaBundle
  site: RuleSite
  domain: string
}) {
  const slots = [site.slot]
  const who = site.kind === 'who'
  const mark = markOf(site)
  const name = who ? `${onName(site)} · ${site.slot}` : site.title
  const anchor = site.on.target
  const kernel = kernelDefaultOf(site, domain, slots)
  const { reading } = site
  const named = site.policies.filter((policy) => policy.direct)
  const through = site.policies.filter((policy) => !policy.direct)
  // A call rule others read alike guards them all: the map names them in one row.
  const guards = ruleRowOf(bundle, site.id)?.names ?? []
  const sitsOn = (
    <>
      <Fact label={who ? 'Sits on' : 'Declared on'}>
        <Link target={site.on.target} domainId={bundle.domainId} mono={site.on.kind !== 'class'}>
          {onName(site)}
        </Link>
      </Fact>
      {guards.length > 1 && (
        <Fact label="Guards">
          <span data-rule-guards="">
            <Names names={guards} domainId={bundle.domainId} />
          </span>
        </Fact>
      )}
    </>
  )
  return (
    <Page
      domainId={bundle.domainId}
      data-comment-outline-inset=""
      data-rule-page="site"
      data-rule-site={site.id}
      data-anchor-ref={anchor}
      data-anchor-excerpt={name}
      data-commentable=""
    >
      <Title
        kicker={who ? `Rule · ${listed(slots)}` : 'Constraint'}
        name={name}
        mono={!who}
        icon={who && mark ? <RuleMark mark={mark} /> : who ? <ShieldCheck /> : <ConstraintMark />}
        domainId={bundle.domainId}
        anchor={anchor}
      >
        {sitsOn}
      </Title>
      {kernel !== undefined ? (
        <KernelDefault site={site} domain={domain} domainId={bundle.domainId} sentence={kernel} />
      ) : reading.status === 'unread' ? (
        <Section label="Rule">
          {mark && <Admission mark={mark} />}
          <UnreadNote unread={reading} />
        </Section>
      ) : (
        <RuleHost rule={reading.rule} className="block space-y-8">
          <Section label="Rule" data-rule-page-reading="">
            {mark && <Admission mark={mark} />}
            <div className="text-[14px] leading-relaxed">
              <Reading />
            </div>
            <div className="text-[12px]">
              <Cast />
            </div>
            {site.written === 'true' && <Meta>Written true.</Meta>}
            {named.length > 0 && (
              <Meta data-rule-policies="">
                Checks <Policies keys={named.map((each) => each.key)} domainId={bundle.domainId} />
              </Meta>
            )}
            {through.length > 0 && (
              <Meta>
                Through{' '}
                <Policies keys={through.map((each) => each.key)} domainId={bundle.domainId} />
              </Meta>
            )}
          </Section>
          <Staged label="Show the walk and its Figure">
            <RuleStage title={name} tone={who ? (opOf(site.slot) ?? 'who') : 'what'} />
          </Staged>
          <Section label="Notation">
            <RuleNames rule={reading.rule} domainId={bundle.domainId} />
            <div className="overflow-x-auto rounded-md bg-muted/60 px-3 py-2 text-[12px]">
              <Notation />
            </div>
          </Section>
          <FocusedWordCard footer="Click pins its scope · ↑ ↓ widen, narrow · Esc clears" />
        </RuleHost>
      )}
    </Page>
  )
}

/** The functions a rule guards, as chips that wrap and each select their own. */
function Names({ names, domainId }: { names: readonly SceneRuleName[]; domainId: string }) {
  return (
    <ul className="flex min-w-0 flex-wrap gap-1" data-rule-names="">
      {names.map((name) => (
        <li
          key={name.id}
          className="min-w-0 max-w-full truncate rounded border border-border/70 bg-muted/40 px-1.5 text-[12px] leading-[20px]"
        >
          <Link target={name.id} domainId={domainId} mono>
            {name.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Whom the Kernel admits where nothing decides, one mark each: who they are, then why. */
interface Admitted {
  readonly who: 'root' | 'domain' | 'holders' | 'everyone' | 'signed-in'
  readonly glyph: LucideIcon
  readonly tone: string
  readonly label: string
  readonly detail?: string
}

const ROOT: Admitted = {
  who: 'root',
  glyph: Crown,
  tone: 'var(--color-admit-closed)',
  label: 'Root',
}

function admittedOf(
  site: RuleSite | undefined,
  domain: string,
  auth?: 'open' | 'signed-in',
): readonly Admitted[] {
  if (auth === 'open' || (site && markOf(site)?.admits === 'open'))
    return [
      { who: 'everyone', glyph: Globe, tone: 'var(--color-admit-open)', label: 'Every caller' },
    ]
  if (auth === 'signed-in')
    return [
      {
        who: 'signed-in',
        glyph: UserCheck,
        tone: 'var(--color-admit-signed-in)',
        label: 'Any signed-in caller',
      },
    ]
  const admitted: Admitted[] = [
    ROOT,
    {
      who: 'domain',
      glyph: Blocks,
      tone: 'var(--color-admit-closed)',
      label: domain,
      detail: 'the Domain',
    },
  ]
  if (site && markOf(site)?.admits === 'holders')
    admitted.push({
      who: 'holders',
      glyph: KeyRound,
      tone: 'var(--muted-foreground)',
      label: `Holders of ${site.slot}`,
      detail: `on ${onName(site)}`,
    })
  return admitted
}

/** Whom it admits, as marks; the sentence that says so, under them. */
function AdmittedMarks({ admitted }: { admitted: readonly Admitted[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" data-rule-admits="">
      {admitted.map(({ who, glyph: Glyph, tone, label, detail }) => (
        <li
          key={who}
          data-rule-admit={who}
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12.5px]"
          style={{
            borderColor: `color-mix(in oklch, ${tone} 35%, transparent)`,
            background: `color-mix(in oklch, ${tone} 8%, transparent)`,
          }}
        >
          <Glyph aria-hidden className="size-3.5 flex-none" style={{ color: tone }} />
          <span className="truncate font-medium">{label}</span>
          {detail && <span className="truncate text-muted-foreground">{detail}</span>}
        </li>
      ))}
    </ul>
  )
}

/**
 * A rule nothing writes: the Kernel's default as its mark, whom that admits as marks, the
 * sentence under them, and where a rule would be written to decide instead.
 */
function KernelDefault({
  site,
  domain,
  domainId,
  sentence,
}: {
  site: RuleSite
  domain: string
  domainId: string
  sentence: string
}) {
  const mark = markOf(site)
  const callable = site.on.kind === 'method' || site.on.kind === 'function'
  const slot = callable ? 'policy' : `policies: { ${site.slot}`
  return (
    <>
      <Section label="Who is admitted" data-rule-page-kernel="">
        <div className="space-y-2.5">
          {mark && <Admission mark={mark} />}
          <AdmittedMarks admitted={admittedOf(site, domain)} />
          <p className="text-[13px] leading-relaxed text-muted-foreground">{sentence}</p>
        </div>
      </Section>
      <Section label="Where a rule goes" data-rule-page-where="">
        <p className="text-[13px] leading-relaxed">
          {site.written === 'false' ? 'It is written false in ' : 'A rule is written in '}
          the declaration of{' '}
          <Link target={site.on.target} domainId={domainId} mono>
            {onName(site)}
          </Link>
          {site.written === 'false' ? '; a Policy there decides instead:' : ':'}
        </p>
        <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-[12px]">
          {callable ? `${slot}: ({ check, self }) => …` : `${slot}: () => SomePolicy }`}
        </pre>
      </Section>
    </>
  )
}

/** A call row no rule decides: the contract opens its functions to anyone, or anyone signed in. */
function OpenCallPage({ bundle, row }: { bundle: StudioSchemaBundle; row: SceneRule }) {
  const owner = ruleOwnerOf(row.id)
  const ownerName = owner === DOMAIN_FUNCTIONS ? 'Domain functions' : classOfTarget(owner).name
  return (
    <Page domainId={bundle.domainId} data-rule-page="open" data-rule-row={row.id}>
      <Title
        kicker="Rule · call"
        name={`${ownerName} · ${row.text}`}
        icon={row.marks?.[0] ? <RuleMark mark={row.marks[0]} /> : <ShieldCheck />}
        domainId={bundle.domainId}
        anchor={owner}
      >
        {(row.names?.length ?? 0) > 0 && (
          <Fact label="Guards">
            <span data-rule-guards="">
              <Names names={row.names!} domainId={bundle.domainId} />
            </span>
          </Fact>
        )}
      </Title>
      <Section label="Who is admitted" data-rule-page-contract="">
        <div className="space-y-2.5">
          {row.marks?.[0] && <Admission mark={row.marks[0]}>by its contract</Admission>}
          <AdmittedMarks
            admitted={admittedOf(
              undefined,
              '',
              row.marks?.[0]?.admits === 'open' ? 'open' : 'signed-in',
            )}
          />
          <p className="text-[13px] leading-relaxed text-muted-foreground">{row.title}</p>
        </div>
      </Section>
      <Section label="Where a rule goes" data-rule-page-where="">
        <p className="text-[13px] leading-relaxed">
          A call rule is written on each function, beside its contract; one written there decides
          instead of the contract:
        </p>
        <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-[12px]">
          {"auth: 'authorized',\npolicy: ({ check, self }) => …"}
        </pre>
      </Section>
    </Page>
  )
}

/** Policies by key, as links that open them. */
function Policies({ keys, domainId }: { keys: readonly string[]; domainId: string }) {
  return (
    <>
      {keys.map((key, index) => (
        <span key={key}>
          {index > 0 && ', '}
          <Link target={`policy.${key}`} domainId={domainId} mono>
            {key.slice(key.indexOf(':policy.') + ':policy.'.length)}
          </Link>
        </span>
      ))}
    </>
  )
}

/** One rule as a list reads it: its sentence, what the Kernel admits instead, or why it is not read. */
function SiteSentence({ site, domain }: { site: RuleSite; domain: string }) {
  const kernel = kernelDefaultOf(site, domain)
  if (kernel !== undefined)
    return <p className="text-[13px] leading-relaxed text-muted-foreground">{kernel}</p>
  if (site.reading.status === 'unread') return <UnreadNote unread={site.reading} />
  return (
    <RuleHost rule={site.reading.rule} className="block">
      <div className="text-[13px] leading-relaxed">
        <Reading />
      </div>
      <FocusedWordCard />
    </RuleHost>
  )
}

function FoldPage({
  bundle,
  fold,
  domain,
}: {
  bundle: StudioSchemaBundle
  fold: SceneRule
  domain: string
}) {
  const owner = ruleOwnerOf(fold.id)
  const functions = owner === DOMAIN_FUNCTIONS
  const ownerName = functions ? 'Domain functions' : classOfTarget(owner).name
  const calls = fold.tone === 'who'
  const rows = fold.rows ?? []
  return (
    <Page
      domainId={bundle.domainId}
      data-comment-outline-inset=""
      data-rule-page="fold"
      data-rule-fold={fold.id}
      data-anchor-ref={functions ? undefined : owner}
      data-anchor-excerpt={ownerName}
      data-commentable={functions ? undefined : ''}
    >
      <Title
        kicker={calls ? 'Calls' : 'Constraints'}
        name={`${ownerName} · ${fold.label}`}
        icon={calls ? <RuleMarks marks={fold.marks ?? []} /> : <ConstraintMark />}
        domainId={bundle.domainId}
        anchor={functions ? DOMAIN_FUNCTIONS : owner}
      >
        <Meta>{fold.text}</Meta>
        {!functions && (
          <Fact label="Sits on">
            <Link target={owner} domainId={bundle.domainId}>
              {ownerName}
            </Link>
          </Fact>
        )}
      </Title>
      <Section
        label={calls ? 'Calls' : 'Constraints'}
        kind={calls ? 'calls' : 'constraints'}
        count={rows.length}
      >
        <FoldRows bundle={bundle} rows={rows} domain={domain} />
      </Section>
    </Page>
  )
}

/**
 * The rules a fold holds, one after another: a call rule as the functions it guards, each
 * selecting its own, then its sentence; a constraint as its row, which opens it, then its
 * sentence. A row no rule decides says what its contract admits.
 */
export function FoldRows({
  bundle,
  rows,
  domain,
}: {
  bundle: StudioSchemaBundle
  rows: readonly SceneRule[]
  domain: string
}) {
  return (
    <div className="divide-y divide-border/60">
      {rows.map((row) => {
        const site = ruleSiteOf(bundle, row.id)
        const names = row.names ?? []
        const mark = row.marks?.[0]
        return (
          <div
            key={row.id}
            data-rule-fold-row={row.id}
            className="min-w-0 space-y-1.5 py-2.5 first:pt-0"
          >
            {mark && (
              <Admission mark={mark} className="max-w-full" title={row.title}>
                {site ? undefined : 'by its contract'}
              </Admission>
            )}
            <div className="min-w-0 text-[12.5px] leading-relaxed" data-rule-guards="">
              {names.length > 0 ? (
                <Names names={names} domainId={bundle.domainId} />
              ) : (
                <Link target={row.id} domainId={bundle.domainId} mono>
                  {row.text}
                </Link>
              )}
            </div>
            {site && (!mark || mark.admits === 'policy' || mark.admits === 'unread') && (
              <SiteSentence site={site} domain={domain} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ConstraintPage({
  bundle,
  id,
  domain,
}: {
  bundle: StudioSchemaBundle
  id: string
  domain: string
}) {
  const sites = constraintSites(rulesOf(bundle), id)
  const label = sites[0] ? constraintFormOf(sites[0]).label : id.slice('constraint.'.length)
  return (
    <Page domainId={bundle.domainId} data-rule-page="constraint" data-rule-constraint={id}>
      <Title
        kicker="Constraint"
        name={label}
        icon={<ConstraintMark />}
        domainId={bundle.domainId}
        anchor={id}
      >
        <Meta>
          {sites.length} {sites.length === 1 ? 'place' : 'places'}
        </Meta>
      </Title>
      <Section label="Sits on" count={sites.length}>
        {sites.length === 0 ? (
          <Empty>No declaration of this Schema has this form.</Empty>
        ) : (
          <div className="divide-y divide-border/60">
            {sites.map((site) => (
              <div
                key={site.id}
                data-rule-constraint-site={site.id}
                className="space-y-1.5 py-2.5 first:pt-0"
              >
                <p className="text-[13px]">
                  <Link target={site.id} domainId={bundle.domainId}>
                    {onName(site)}
                  </Link>
                  <span className="font-mono text-[11.5px] text-muted-foreground">
                    {' '}
                    {site.title}
                  </span>
                </p>
                <SiteSentence site={site} domain={domain} />
              </div>
            ))}
          </div>
        )}
      </Section>
    </Page>
  )
}
