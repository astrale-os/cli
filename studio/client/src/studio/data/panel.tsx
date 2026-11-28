/**
 * The Data level's panel: the selection read in sentences. Nothing selected reads the dataset; a
 * Node reads its Class, its properties as a small table, its Edges as sentences and what points
 * at it; an Edge reads its relationship and ends; a region lists its Nodes as a table; a link that
 * gathers Edges lists them. Under Access each page adds the verdicts of the identity
 * read as — read, traverse, call — each with its rule, why, a way to light its proof, and a way
 * to pin it to a Scenario. A Policy reads what it admits on the dataset: how many of its pairs
 * of an identity and a Node or Edge, each pair a sentence that lights on the map and opens on
 * the verdicts the Kernel gives it where the Policy sits, each pinnable. Under Scenarios
 * a Node's or an Edge's page opens on the Scenario steps that involve it.
 */

import type { Data, FactId, Rule } from '@astrale-os/visual'
import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { Reading } from '@astrale-os/visual/react'
import { ArrowUpRight, Lightbulb, ShieldCheck } from 'lucide-react'
import { Fragment, type ReactNode, useMemo } from 'react'

import { cn } from '@/lib/utils'

import type { RuleOp } from '../scene/types'
import type { Verdict } from './access'
import type { Pinning } from './pin'
import type { PolicyPair, PolicyPairs } from './policy-pairs'
import type { DataScene } from './project'
import type { DecidedCase } from './rule-scope'
import type { DataTab } from './tabs'

import { TONE_TEXT } from '../canvas/tones'
import { ClassGlyph } from '../inspector/marks'
import {
  CallableName,
  ClassName,
  Disclosure,
  Empty,
  Fact,
  Fold,
  Meta,
  openTarget,
  Page,
  Section,
  Title,
} from '../inspector/parts'
import { classLink, type ClassLink } from '../inspector/structure'
import { withArticle } from '../inspector/words'
import { originShort } from '../lenses/structure'
import { opOf } from '../rules/admission'
import { classOfTarget, type PolicyRule, type RuleSite, type Unread } from '../rules/model'
import { ADMISSION_TONES, OpMarks } from '../rules/rule-mark'
import { RuleHost, UnreadNote } from '../rules/rule-view'
import { Staged } from '../stage/staged'
import { RuleStage } from '../stage/walk-stage'
import { type Access, type Reads, edgeWords, edgesOf } from './access'
import { classLinkOf, DATA_SECTIONS, DataMark, OUTCOME_MARKS, relationshipLinkOf } from './marks'
import {
  type DataEdge,
  type DataNode,
  type DatasetModel,
  type PropertyLine,
  admittedSentence,
  classLabel,
  datasetLabel,
  edgeId,
  endLabel,
  identityLabel,
  indexOfEdgeId,
  nodeId,
  outsideId,
  pathOfNodeId,
} from './model'
import { PinButton } from './pin'
import { pairCase, pairVerdicts } from './policy-pairs'
import { isGathered, isStandIn, regionOfStandIn } from './project'
import { DatasetRule } from './rule-scope'
import { PathList, VerdictBy } from './verdict-parts'
import { verdictView } from './verdict-view'
import { numbersOf, walkFactsOf } from './walk'
import { edgeSentence, kindOf } from './words'

/** The verdicts of the selection, as the level decided them for the identity read as. */
export type Decided =
  | {
      readonly kind: 'node'
      readonly read: Verdict
      readonly traverse: readonly Verdict[]
      /** Edges of the Node not decided */
      readonly undecided: number
      readonly calls: readonly Verdict[]
    }
  | { readonly kind: 'edge'; readonly traverse: Verdict; readonly read: Verdict }

export interface DataPanelProps {
  domainId: string
  /** the question asked of the dataset: Access adds verdicts, Scenarios the steps that involve the selection */
  tab: DataTab
  model: DatasetModel
  access?: Access
  /** why no rule of the Domain can be read, when none can */
  unread?: Unread
  identities: ReadonlySet<string>
  /** the identity Rules reads as */
  identity: string
  reads?: Reads
  projection: DataScene
  selected?: string
  /** the Policy selected, and what it admits so far */
  policy?: PolicyRule
  pairs?: PolicyPairs
  decided?: Decided
  /** the verdict whose proof the map lights; a Policy's pair lit (`pair:<id>`) */
  lit?: string
  /** under Access: how a verdict is pinned to a Scenario */
  pinning?: Pinning
  /** under Scenarios: the Scenario steps that involve the Node or Edge selected */
  steps?: ReactNode
  onSelect: (id: string | undefined) => void
  onLight: (verdict: string) => void
  onIdentity: (identity: string) => void
}

/** How many characters of a property's value the table shows; the whole value is its title. */
const VALUE_SHOWN = 160
/** How many rows a table shows before the rest fold behind a count. */
const TABLE_ROWS = 50

export function DataPanel(props: DataPanelProps) {
  const { selected, model } = props
  const path = selected ? pathOfNodeId(selected) : undefined
  const edgeIndex = selected ? indexOfEdgeId(selected) : undefined
  let page: ReactNode
  if (props.policy) page = <PolicyPage {...props} policy={props.policy} />
  else if (path !== undefined && model.nodes.has(path))
    page = <NodePage {...props} node={model.nodes.get(path)!} />
  else if (edgeIndex !== undefined && model.edgeAt.has(edgeIndex))
    page = <EdgePage {...props} edge={model.edgeAt.get(edgeIndex)!} />
  else if (selected && isStandIn(selected) && model.classByTarget.has(regionOfStandIn(selected)))
    page = (
      <ClassPage
        {...props}
        target={regionOfStandIn(selected)}
        held={props.projection.held.get(selected)}
      />
    )
  else if (selected && model.classByTarget.has(selected))
    page = <ClassPage {...props} target={selected} />
  else if (selected && isGathered(selected) && props.projection.edgesOf.has(selected))
    page = <GatheredPage {...props} link={selected} />
  else if (selected?.startsWith('outside.') && model.outside.has(selected.slice('outside.'.length)))
    page = <EndPage {...props} path={selected.slice('outside.'.length)} />
  else page = <DatasetPage {...props} />
  // Each selection reads from its top.
  return (
    <Page key={selected ?? '@dataset'} domainId={props.domainId} data-data-panel="">
      {page}
    </Page>
  )
}

// ── shared parts ──

/** A Node, an end or an Edge named as a button that selects it on the map. */
function Pick({
  id,
  children,
  mono = false,
  onSelect,
}: {
  id: string
  children: ReactNode
  mono?: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      data-data-pick={id}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(id)
      }}
      className={cn(
        'inline rounded-sm text-left underline decoration-foreground/20 underline-offset-[3px] transition-colors hover:decoration-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        mono ? 'font-mono text-[0.92em]' : 'font-medium',
      )}
    >
      {children}
    </button>
  )
}

const pickIdOf = (model: DatasetModel, path: string) =>
  model.outside.has(path) ? outsideId(path) : nodeId(path)

/** Properties as a small table: the name, then the value; a nested value's parts indented under it. */
function PropertyTable({ lines }: { lines: readonly PropertyLine[] }) {
  if (lines.length === 0) return <Empty>No property is set.</Empty>
  return (
    <table data-data-properties="" className="w-full table-fixed border-collapse text-[13px]">
      <tbody>
        {lines.map((line) => (
          <tr key={line.key} className="border-b border-border/60 last:border-0 align-top">
            <th
              scope="row"
              title={line.key}
              className="w-[38%] truncate py-1.5 pr-3 text-left font-normal text-muted-foreground"
              style={{ paddingLeft: `${line.depth * 0.75}rem` }}
            >
              {line.label}
            </th>
            <td
              title={line.value.length > VALUE_SHOWN ? line.value : undefined}
              className="break-words py-1.5 font-mono text-[12px] text-foreground/90"
            >
              {line.value.length > VALUE_SHOWN
                ? `${line.value.slice(0, VALUE_SHOWN)}…`
                : line.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * The number the walk of `rule` gives each Node and Edge it stands at, in the case decided; none
 * while the walk is not asked for (`on`), or the rule is not decided on the dataset.
 */
function useWalkNumbers(
  on: boolean,
  rule: Rule | undefined,
  data: Data | undefined,
  decided: DecidedCase | undefined,
): ReadonlyMap<FactId, number> | undefined {
  return useMemo(
    () =>
      on && rule && data && decided
        ? numbersOf(walkFactsOf(rule, data, decided.situation, decided.fact))
        : undefined,
    [data, decided, on, rule],
  )
}

/** A Node or an end named as a button that selects it, its Class's icon in its hue before it. */
function EndPick({ props, path, label }: { props: DataPanelProps; path: string; label?: string }) {
  const cls = props.model.classOf.get(path)
  return (
    <span className="whitespace-nowrap">
      {cls && (
        <ClassGlyph link={classLinkOf(cls)} className="mr-[0.3em] inline-block align-[-0.15em]" />
      )}
      <Pick id={pickIdOf(props.model, path)} onSelect={props.onSelect}>
        {label ?? endLabel(props.model, path)}
      </Pick>
    </span>
  )
}

/**
 * One verdict: allowed, refused or can't tell; the operation it decides and whom the rule there
 * admits, marked as the Schema marks them; by which rule; why; the Edges that prove it; and its
 * proof to light, when it can be. Lit, a verdict a rule decides on the dataset stages its walk
 * and its Figure, drawn on the case decided.
 */
function VerdictRow({
  verdict,
  domainId,
  origin,
  data,
  lit,
  onLight,
  pinning,
}: {
  verdict: Verdict
  domainId: string
  origin: string
  data?: Data
  lit: boolean
  onLight?: (verdict: string) => void
  pinning?: Pinning
}) {
  const view = verdictView(verdict, origin)
  const mark = OUTCOME_MARKS[view.outcome]
  const lights = view.lights.nodes.length + view.lights.edges.length > 0
  const rule = verdict.by.kind === 'rule' ? verdict.by.rule : undefined
  const staged = lit && rule !== undefined && data !== undefined
  const numbers = useWalkNumbers(staged, rule, data, verdict.decided)
  const row = (
    <div
      data-verdict={view.id}
      data-outcome={view.outcome}
      data-lit={lit ? '' : undefined}
      className={cn('space-y-1.5 rounded-md py-2 pl-2 pr-1', lit && 'bg-accent/60')}
    >
      <div className="flex items-start gap-2">
        <DataMark mark={mark} className="mt-0.5 h-4 w-4" data-outcome-mark={view.outcome} />
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed">{view.sentence}</p>
        {lights && onLight && (
          <button
            type="button"
            data-verdict-light={view.id}
            aria-pressed={lit}
            title={lit ? 'Its proof is lit on the map' : 'Light its proof on the map'}
            onClick={() => onLight(view.id)}
            className={cn(
              'grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              lit ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <Lightbulb className="h-3.5 w-3.5" />
          </button>
        )}
        {pinning && <PinButton verdict={verdict} pinning={pinning} />}
      </div>
      <VerdictBy view={view} domainId={domainId} className="pl-6" />
      <PathList
        path={view.path}
        tone={view.op}
        className="pl-6"
        data-verdict-path=""
        {...(numbers ? { numbers } : {})}
      />
      {verdict.unread && <UnreadNote unread={verdict.unread} className="pl-6" />}
      {rule && (
        <div className="space-y-2 pl-6">
          <Disclosure label="Rule">
            {staged ? (
              <div className="text-[13px] leading-relaxed">
                <Reading />
              </div>
            ) : (
              <DatasetRule
                rule={rule}
                {...(data ? { data } : {})}
                {...(verdict.decided ? { decided: verdict.decided } : {})}
                className="block text-[13px] leading-relaxed"
              >
                <Reading />
              </DatasetRule>
            )}
          </Disclosure>
          {staged && (
            <Staged label="Show the walk and its Figure">
              <RuleStage
                title={`${view.policies.map((policy) => policy.name).join(', ') || view.by} · ${view.sentence.replace(/\.$/, '')}`}
                tone={view.op}
                marked={verdict.decided !== undefined}
              />
            </Staged>
          )}
        </div>
      )}
    </div>
  )
  // Lit, the row is the rule's scope: what the stage points at lights its words too.
  return staged ? (
    <DatasetRule
      rule={rule}
      data={data}
      {...(verdict.decided ? { decided: verdict.decided } : {})}
      className="block"
    >
      {row}
    </DatasetRule>
  ) : (
    row
  )
}

/** The verdicts of one kind, the lit one marked. */
function Verdicts({ verdicts, props }: { verdicts: readonly Verdict[]; props: DataPanelProps }) {
  return (
    <Fold
      items={verdicts}
      limit={8}
      render={(verdict) => (
        <VerdictRow
          key={verdict.id}
          verdict={verdict}
          domainId={props.domainId}
          origin={props.model.origin}
          {...(props.access ? { data: props.access.data } : {})}
          lit={props.lit === verdict.id}
          onLight={props.onLight}
          {...(props.pinning ? { pinning: props.pinning } : {})}
        />
      )}
    />
  )
}

/** Why no verdict can be given at all, when the Domain's rules cannot be read. */
function NoRules({ unread }: { unread?: Unread }) {
  if (!unread) return null
  return (
    <Section label="Rules" kind="policies">
      <UnreadNote unread={unread} />
    </Section>
  )
}

/** The Edges of a Node said from it: each Edge a sentence whose other end selects it. */
function EdgeLines({
  props,
  edges,
  from,
}: {
  props: DataPanelProps
  edges: readonly DataEdge[]
  from: 'source' | 'target'
}) {
  const { model, access, identities } = props
  const terms = access?.terms
  return (
    <Fold
      items={edges}
      limit={8}
      render={(edge) => {
        const otherPath = from === 'source' ? edge.to : edge.from
        const sentence = terms
          ? edgeSentence(model, terms, identities, edge, from)
          : {
              before: from === 'source' ? 'Points at' : '',
              other: { path: otherPath, label: endLabel(model, otherPath) },
              after: from === 'source' ? 'by' : 'points at it by',
              name: edge.name,
            }
        return (
          <div key={edge.id} data-data-edge={edge.id} className="text-[13px] leading-relaxed">
            {sentence.before}{' '}
            <EndPick props={props} path={sentence.other.path} label={sentence.other.label} />
            {sentence.after && ` ${sentence.after}`}
            {sentence.name !== undefined && (
              <>
                {' '}
                <ClassName
                  link={relationshipLinkOf(edge)}
                  domainId={props.domainId}
                  text={sentence.name}
                  mono
                />
              </>
            )}
            .{' '}
            <Pick id={edge.id} mono onSelect={props.onSelect}>
              <span className="text-[11px] text-muted-foreground">Edge {edge.index}</span>
            </Pick>
          </div>
        )
      }}
    />
  )
}

// ── pages ──

function DatasetPage(props: DataPanelProps) {
  const { model, tab, reads, access, domainId } = props
  const dataset = model.dataset
  const variables = Object.entries(dataset.variables).sort(([a], [b]) => a.localeCompare(b))
  const readsOf = (target: string) => reads?.classes.find((each) => each.target === target)
  return (
    <>
      <Title
        kicker="Dataset"
        name={datasetLabel(dataset)}
        description={dataset.description}
        domainId={domainId}
        anchor={`dataset.${dataset.id}`}
      >
        <div className="space-y-1">
          <Fact label="Module">
            <span className="font-mono text-[12px]">{dataset.path}</span>
          </Fact>
          <Fact label="Holds">
            {model.order.length} Nodes, {model.edges.length} Edges, {model.classes.length} Classes
          </Fact>
          <Fact label="Schema">{admittedSentence(dataset)}</Fact>
        </div>
      </Title>
      {tab === 'access' && (
        <Section label={`Read · as ${identityLabel(props.model, props.identity)}`} kind="reads">
          {reads && reads.pending === 0 ? (
            <p className="text-[13px] leading-relaxed">
              {identityLabel(props.model, props.identity, true)} reads {reads.total.allowed} of{' '}
              {reads.total.total} Nodes
              {reads.total.unknown > 0 ? `; for ${reads.total.unknown} the rules can't tell.` : '.'}
            </p>
          ) : (
            <Empty>
              {access ? 'Deciding what it reads…' : 'No rule of the Domain can be read.'}
            </Empty>
          )}
        </Section>
      )}
      <NoRules unread={props.unread} />
      <Section label="Classes" kind={DATA_SECTIONS.classes} count={model.classes.length}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th className="pb-1 text-left font-normal">Class</th>
              <th className="pb-1 text-right font-normal">Nodes</th>
              {tab === 'access' && <th className="pb-1 text-right font-normal">Readable</th>}
            </tr>
          </thead>
          <tbody>
            {model.classes.map((cls) => {
              const counted = readsOf(cls.target)
              return (
                <tr key={cls.target} className="border-t border-border/60">
                  <td className="py-1.5">
                    <span className="whitespace-nowrap">
                      <ClassGlyph
                        link={classLinkOf(cls)}
                        className="mr-[0.3em] inline-block align-[-0.15em]"
                      />
                      <Pick id={cls.target} onSelect={props.onSelect}>
                        {classLabel(cls)}
                      </Pick>
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{cls.nodes.length}</td>
                  {tab === 'access' && (
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {counted && reads?.pending === 0 ? counted.allowed : '…'}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>
      <Section label="Identities" kind={DATA_SECTIONS.identities} count={access?.identities.length}>
        {!access || access.identities.length === 0 ? (
          <Empty>
            This dataset holds no identity: no Node of it is of a Class that is or extends Kernel
            Identity.
          </Empty>
        ) : (
          <Fold
            items={access.identities}
            limit={8}
            className="space-y-1.5"
            render={(one) => (
              <div key={one.id} className="flex items-baseline gap-2 text-[13px]">
                <EndPick props={props} path={one.id} label={one.label} />
                <span className="font-mono text-[11px] text-muted-foreground">{one.id}</span>
                {tab === 'access' && one.id !== props.identity && (
                  <button
                    type="button"
                    data-read-as={one.id}
                    onClick={() => props.onIdentity(one.id)}
                    className="ml-auto rounded-sm text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    Read as →
                  </button>
                )}
              </div>
            )}
          />
        )}
      </Section>
      {variables.length > 0 && (
        <Section label="Variables" kind={DATA_SECTIONS.variables} count={variables.length}>
          {/* a variable is named in code, at any length: its column is as wide as the longest
              name, up to a cap past which a name is cut and its whole shown on hover */}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px] leading-relaxed">
            {variables.map(([name, paths]) => (
              <Fragment key={name}>
                <dt
                  title={name}
                  className="max-w-40 truncate pt-px text-[12px] text-muted-foreground"
                >
                  {name}
                </dt>
                <dd className="min-w-0">
                  {paths.map((path, index) => (
                    <span key={path}>
                      {index > 0 && ', '}
                      <Pick id={pickIdOf(model, path)} onSelect={props.onSelect}>
                        {endLabel(model, path)}
                      </Pick>
                    </span>
                  ))}
                </dd>
              </Fragment>
            ))}
          </dl>
        </Section>
      )}
    </>
  )
}

function NodePage(props: DataPanelProps & { node: DataNode }) {
  const { node, model, domainId, tab, decided } = props
  const cls = model.classOf.get(node.path)!
  const outgoing = model.outgoing.get(node.path) ?? []
  const incoming = (model.incoming.get(node.path) ?? []).filter((edge) => edge.from !== node.path)
  const kind = props.access
    ? kindOf(model, props.access.terms, props.identities, node.path)
    : cls.name
  return (
    <>
      <Title
        kicker={`Node · ${classLabel(cls)}`}
        name={node.label}
        icon={<ClassGlyph link={classLinkOf(cls)} />}
        domainId={domainId}
        anchor={node.id}
      >
        <div className="space-y-1">
          <Fact label="Class">
            <ClassName link={classLinkOf(cls)} domainId={domainId} />
            {props.identities.has(node.path) && (
              <span className="text-muted-foreground"> · an identity</span>
            )}
          </Fact>
          <Fact label="Path">
            <span className="break-all font-mono text-[12px]">{node.path}</span>
          </Fact>
          {node.variables.length > 0 && <Fact label="Named">{node.variables.join(', ')}</Fact>}
        </div>
      </Title>
      {tab === 'scenarios' && props.steps}
      {tab === 'access' && decided?.kind === 'node' && (
        <>
          <Section label={`Read · as ${identityLabel(props.model, props.identity)}`} kind="reads">
            <Verdicts verdicts={[decided.read]} props={props} />
          </Section>
          {decided.traverse.length > 0 && (
            <Section
              label="Traverse"
              kind={DATA_SECTIONS.traverse}
              count={decided.traverse.length + decided.undecided}
              hint={decided.undecided > 0 ? `first ${decided.traverse.length} decided` : undefined}
            >
              <Verdicts verdicts={decided.traverse} props={props} />
              {decided.undecided > 0 && (
                <Meta>
                  {decided.undecided} more Edges are not decided here: select one to read its
                  verdict.
                </Meta>
              )}
            </Section>
          )}
          <Section label="Call" kind="calls" count={decided.calls.length}>
            {decided.calls.length === 0 ? (
              <Empty>
                {cls.local
                  ? `No function of the Domain works on ${withArticle(kind)}.`
                  : `${cls.name} is ${cls.origin}'s Class: the level reads no function of another Domain.`}
              </Empty>
            ) : (
              <Verdicts verdicts={decided.calls} props={props} />
            )}
          </Section>
        </>
      )}
      {tab === 'access' && <NoRules unread={props.unread} />}
      <Section
        label="Properties"
        kind="properties"
        count={node.properties.filter((line) => line.depth === 0).length}
      >
        <PropertyTable lines={node.properties} />
      </Section>
      <Section label="Edges" kind="relationships" count={outgoing.length}>
        {outgoing.length === 0 ? (
          <Empty>It points at nothing.</Empty>
        ) : (
          <EdgeLines props={props} edges={outgoing} from="source" />
        )}
      </Section>
      <Section label="Pointed at by" kind="relationships" count={incoming.length}>
        {incoming.length === 0 ? (
          <Empty>Nothing points at it.</Empty>
        ) : (
          <EdgeLines props={props} edges={incoming} from="target" />
        )}
      </Section>
    </>
  )
}

function EdgePage(props: DataPanelProps & { edge: DataEdge }) {
  const { edge, model, domainId, tab, decided, access } = props
  const relationship = relationshipLinkOf(edge)
  const words = access ? edgeWords(access, edge) : undefined
  return (
    <>
      <Title
        kicker="Edge"
        name={`${endLabel(model, edge.from)} → ${endLabel(model, edge.to)}`}
        icon={<ClassGlyph link={relationship} />}
        domainId={domainId}
        anchor={edge.id}
      >
        <div className="space-y-1">
          <Fact label="Relationship">
            <ClassName link={relationship} domainId={domainId} mono />
          </Fact>
          <Fact label="From">
            <EndPick props={props} path={edge.from} />
          </Fact>
          <Fact label="To">
            <EndPick props={props} path={edge.to} />
          </Fact>
          {words && <Fact label="Reads">{words}.</Fact>}
        </div>
      </Title>
      {tab === 'scenarios' && props.steps}
      {tab === 'access' && decided?.kind === 'edge' && (
        <Section
          label={`As ${identityLabel(props.model, props.identity)}`}
          kind={DATA_SECTIONS.asIdentity}
        >
          <Verdicts verdicts={[decided.traverse, decided.read]} props={props} />
        </Section>
      )}
      {tab === 'access' && <NoRules unread={props.unread} />}
      <Section
        label="Properties"
        kind="properties"
        count={edge.properties.filter((line) => line.depth === 0).length}
      >
        <PropertyTable lines={edge.properties} />
      </Section>
    </>
  )
}

/** A region, or the card its Nodes past the bound stand behind: its Nodes as a table. */
function ClassPage(props: DataPanelProps & { target: string; held?: readonly string[] }) {
  const { model, target, held, tab, reads, domainId } = props
  const cls = model.classByTarget.get(target)!
  const paths = held ?? cls.nodes
  const counted = reads?.classes.find((each) => each.target === target)
  const rows = useMemo(() => paths.map((path) => model.nodes.get(path)!), [model, paths])
  const keys = useMemo(() => {
    // the properties most of its Nodes set, as columns: at most two
    const seen = new Map<string, { label: string; count: number }>()
    for (const node of rows)
      for (const line of node.properties)
        if (line.depth === 0) {
          const known = seen.get(line.key)
          seen.set(line.key, { label: line.label, count: (known?.count ?? 0) + 1 })
        }
    return [...seen]
      .filter(([, column]) => column.count * 2 >= rows.length)
      .slice(0, 2)
      .map(([key, column]) => ({ key, label: column.label }))
  }, [rows])
  const shown = rows.slice(0, TABLE_ROWS)
  return (
    <>
      <Title
        kicker={held ? `Nodes past the first ${cls.nodes.length - held.length}` : 'Class'}
        name={classLabel(cls)}
        icon={<ClassGlyph link={classLinkOf(cls)} />}
        domainId={domainId}
        anchor={cls.target}
      >
        <div className="space-y-1">
          <Fact label="Schema">
            <ClassName link={classLinkOf(cls)} domainId={domainId} />
          </Fact>
          <Fact label="Nodes">
            {held
              ? `${held.length} of its ${cls.nodes.length} Nodes stand behind this card.`
              : `${cls.nodes.length} in this dataset.`}
          </Fact>
          {tab === 'access' && counted && reads?.pending === 0 && (
            <Fact label="Readable">
              {identityLabel(props.model, props.identity, true)} reads {counted.allowed} of{' '}
              {counted.total}
              {counted.unknown > 0 ? `; can't tell for ${counted.unknown}` : ''}.
            </Fact>
          )}
        </div>
      </Title>
      <Section
        label="Nodes"
        kind={DATA_SECTIONS.nodes}
        count={rows.length}
        hint={rows.length > TABLE_ROWS ? `first ${TABLE_ROWS}` : undefined}
      >
        <table data-data-table="" className="w-full table-fixed border-collapse text-[13px]">
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th className="pb-1 text-left font-normal">Node</th>
              {keys.map((column) => (
                <th
                  key={column.key}
                  className="truncate pb-1 text-left font-normal"
                  title={column.key}
                >
                  {column.label}
                </th>
              ))}
              {tab === 'access' && <th className="w-20 pb-1 text-right font-normal">Read</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((node) => {
              const verdict =
                tab === 'access' && reads?.pending === 0 ? reads.verdicts.get(node.path) : undefined
              const mark = verdict ? OUTCOME_MARKS[verdict.outcome] : undefined
              return (
                <tr key={node.path} className="border-t border-border/60 align-top">
                  <td className="truncate py-1.5 pr-2">
                    <Pick id={node.id} onSelect={props.onSelect}>
                      {node.label}
                    </Pick>
                  </td>
                  {keys.map((column) => (
                    <td
                      key={column.key}
                      className="truncate py-1.5 pr-2 font-mono text-[12px] text-foreground/80"
                    >
                      {node.properties.find((line) => line.key === column.key)?.value ?? '—'}
                    </td>
                  ))}
                  {tab === 'access' && (
                    <td
                      data-node-read={verdict?.outcome}
                      className={cn('py-1.5 text-right text-[12px]', mark && TONE_TEXT[mark.tone])}
                    >
                      {mark ? (
                        <span className="inline-flex items-center gap-1">
                          <DataMark mark={mark} className="h-3.5 w-3.5" />
                          {mark.word}
                        </span>
                      ) : (
                        '…'
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length > TABLE_ROWS && (
          <Meta>{rows.length - TABLE_ROWS} more: search the Index for one by name or path.</Meta>
        )}
      </Section>
    </>
  )
}

/** A link that carries several Edges of one relationship: each listed. */
function GatheredPage(props: DataPanelProps & { link: string }) {
  const { model, link, projection, domainId } = props
  const indexes = projection.edgesOf.get(link) ?? []
  const edges = indexes.map((index) => model.edgeAt.get(index)!)
  const [first] = edges
  const fromClass = first ? model.classOf.get(first.from) : undefined
  const toClass = first ? model.classOf.get(first.to) : undefined
  return (
    <>
      <Title
        kicker="Edges"
        name={`${first?.name ?? ''} ×${edges.length}`}
        {...(first ? { icon: <ClassGlyph link={relationshipLinkOf(first)} /> } : {})}
        mono
        domainId={domainId}
        anchor={link}
      >
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {edges.length} Edges of{' '}
          {first ? <ClassName link={relationshipLinkOf(first)} domainId={domainId} mono /> : null}
          {fromClass && (
            <>
              {' '}
              from <ClassName link={classLinkOf(fromClass)} domainId={domainId} />
            </>
          )}
          {toClass && (
            <>
              {' '}
              to <ClassName link={classLinkOf(toClass)} domainId={domainId} />
            </>
          )}{' '}
          travel as one link: open a region to draw each.
        </p>
      </Title>
      <Section label="Edges" kind="relationships" count={edges.length}>
        <Fold
          items={edges}
          limit={TABLE_ROWS}
          rows
          render={(edge) => (
            <div key={edge.id} className="py-1.5 text-[13px]">
              <Pick id={edge.id} onSelect={props.onSelect}>
                {endLabel(model, edge.from)} → {endLabel(model, edge.to)}
              </Pick>
            </div>
          )}
        />
      </Section>
    </>
  )
}

/** An end an Edge names that the dataset holds no Node for. */
function EndPage(props: DataPanelProps & { path: string }) {
  const { model, path, domainId } = props
  const end = model.outside.get(path)!
  const edges = edgesOf(model, path)
  return (
    <>
      <Title
        kicker={end.kind === 'domain' ? 'The Domain' : 'Outside the dataset'}
        name={end.label}
        domainId={domainId}
        anchor={end.id}
      >
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {end.kind === 'domain'
            ? `The Domain this dataset belongs to, written ${path}: the dataset names it and holds no Node for it.`
            : `An Edge names ${path}, and the dataset holds no Node at that path.`}
        </p>
      </Title>
      <Section label="Edges" kind="relationships" count={edges.length}>
        <Fold
          items={edges}
          limit={TABLE_ROWS}
          render={(edge) => (
            <div key={edge.id} className="text-[13px]">
              <Pick id={edgeId(edge.index)} onSelect={props.onSelect}>
                {endLabel(model, edge.from)} —{edge.name}→ {endLabel(model, edge.to)}
              </Pick>
            </div>
          )}
        />
      </Section>
    </>
  )
}

/** A pair of a Policy, lit on the map: `pair:<identity>|<object>`. */
const PAIR = 'pair:'

/** A place a Policy sits on: a Class, a relationship, a Method or a function, with its slots. */
interface Place {
  readonly site: RuleSite
  readonly ops: readonly RuleOp[]
  readonly slots: readonly string[]
}

/** The places a Policy sits on, the slots of one Class or relationship together. */
function placesOf(sites: readonly RuleSite[], policy: PolicyRule): Place[] {
  const on = new Set(policy.sitsOn.map((one) => one.site))
  const places = new Map<string, { site: RuleSite; slots: string[] }>()
  for (const site of sites) {
    if (!on.has(site.id)) continue
    const key =
      site.on.kind === 'class' || site.on.kind === 'relationship' ? site.on.target : site.id
    const place = places.get(key)
    if (place) place.slots.push(site.slot)
    else places.set(key, { site, slots: [site.slot] })
  }
  return [...places.values()].map(({ site, slots }) => ({
    site,
    slots,
    ops: slots.flatMap((slot) => opOf(slot) ?? []),
  }))
}

/** A Class or relationship a rule sits on, as the Schema marks it. */
function placeLink(site: RuleSite, bundle: StudioSchemaBundle | undefined): ClassLink {
  const relationship = site.on.kind === 'relationship'
  const { name, origin } = classOfTarget(site.on.target)
  const domain = bundle?.ir?.domain
  if (bundle && domain !== undefined)
    return classLink(bundle, { origin: origin ?? domain, kind: 'class', name })
  return {
    target: site.on.target,
    name,
    open: origin === undefined,
    ...(origin === undefined ? {} : { domain: originShort(origin) }),
    ...(relationship ? { relationship: true as const } : {}),
  }
}

/** A place, named as the Schema names it, the operations it decides there marked after it. */
function PlaceName({
  place,
  bundle,
  domainId,
}: {
  place: Place
  bundle?: StudioSchemaBundle
  domainId: string
}) {
  const { on } = place.site
  return (
    <span data-policy-place={place.site.id} className="whitespace-nowrap">
      {on.kind === 'class' || on.kind === 'relationship' ? (
        <ClassName
          link={placeLink(place.site, bundle)}
          domainId={domainId}
          mono={on.kind === 'relationship'}
        />
      ) : on.kind === 'method' ? (
        <CallableName
          target={on.target}
          name={`${on.owner}.${on.name}`}
          glyph="function"
          domainId={domainId}
        />
      ) : on.kind === 'function' ? (
        <CallableName target={on.target} name={on.name} glyph="function" domainId={domainId} />
      ) : (
        'the Schema'
      )}{' '}
      <OpMarks ops={place.ops} className="align-[-0.15em]" />
      <span className="text-muted-foreground"> ({place.slots.join(', ')})</span>
    </span>
  )
}

/** How many of its pairs a Policy admits, in one sentence. */
function admitsWords(name: string, pairs: PolicyPairs): string {
  const total = pairs.pairs.length
  if (total === 0) return `${name} is decided over nothing this dataset holds.`
  const unknown = pairs.unknown > 0 ? `; for ${pairs.unknown} it can't tell` : ''
  return pairs.readsCaller
    ? `${name} admits ${pairs.admitted} of ${total} ${total === 1 ? 'pair' : 'pairs'}${unknown}.`
    : `${name} holds of ${pairs.admitted} of ${total}${unknown}, whoever asks.`
}

/**
 * A Policy: where it sits, what it admits on the dataset pair by pair, and what it says. Its
 * rule is read in the case of the pair lit, its walk and Figure staged on that case.
 */
function PolicyPage(props: DataPanelProps & { policy: PolicyRule }) {
  const { policy, pairs, access, domainId, model } = props
  const places = useMemo(() => placesOf(access?.rules.sites ?? [], policy), [access, policy])
  const decided = pairs && pairs.pending === 0 ? pairs : undefined
  const byOutcome = useMemo(() => {
    const by: Record<PolicyPair['outcome'], PolicyPair[]> = {
      allowed: [],
      refused: [],
      unknown: [],
    }
    for (const pair of decided?.pairs ?? []) by[pair.outcome].push(pair)
    return by
  }, [decided])
  const rule = policy.reading.status === 'read' ? policy.reading.rule : undefined
  // the case the rule is read in: the pair lit, explained as its own case
  const litPair = props.lit?.startsWith(PAIR)
    ? decided?.pairs.find((pair) => `${PAIR}${pair.id}` === props.lit)
    : undefined
  const litCase = useMemo(() => {
    if (!access || !litPair) return undefined
    const explained = pairCase(access, policy, litPair)
    return explained?.status === 'explained'
      ? {
          situation: explained.verdict.situation,
          ...(explained.verdict.fact === undefined ? {} : { fact: explained.verdict.fact }),
        }
      : undefined
  }, [access, litPair, policy])
  return (
    <>
      <Title
        kicker={
          policy.origin === model.origin ? 'Policy' : `Policy · ${originShort(policy.origin)}`
        }
        name={policy.name}
        icon={<ShieldCheck style={{ color: ADMISSION_TONES.policy }} />}
        {...(policy.description === undefined ? {} : { description: policy.description })}
        domainId={domainId}
        anchor={policy.target}
      >
        <div className="space-y-1">
          <Fact label="Sits on">
            {places.length === 0 ? (
              'Nothing of this Domain.'
            ) : (
              <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                {places.map((place) => (
                  <PlaceName
                    key={place.site.id}
                    place={place}
                    {...(access ? { bundle: access.bundle } : {})}
                    domainId={domainId}
                  />
                ))}
              </span>
            )}
          </Fact>
        </div>
        <button
          type="button"
          data-policy-schema={policy.target}
          onClick={() => openTarget(policy.target, domainId)}
          className="inline-flex items-center gap-1 rounded-sm text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          Read it on the Schema <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
        </button>
      </Title>
      <Section
        label="On this dataset"
        kind="policies"
        data-policy-admits={decided ? `${decided.admitted}/${decided.pairs.length}` : undefined}
      >
        {pairs?.unread ? (
          <UnreadNote unread={pairs.unread} />
        ) : !access ? (
          <Empty>No rule of the Domain can be read.</Empty>
        ) : !decided ? (
          <Empty>Deciding what it admits…</Empty>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed">{admitsWords(policy.name, decided)}</p>
            {decided.pairs.length > 0 && (
              <Meta>
                {decided.readsCaller
                  ? 'A pair is an identity of the dataset, or anyone, and a Node or Edge the Policy is decided over.'
                  : 'It reads no caller: each Node or Edge it is decided over is admitted for every identity alike.'}{' '}
                The map lights what it admits; a pair lit, that pair alone.
              </Meta>
            )}
          </>
        )}
      </Section>
      <PairSection {...props} outcome="allowed" listed={byOutcome.allowed} limit={8} />
      <PairSection {...props} outcome="refused" listed={byOutcome.refused} limit={4} />
      <PairSection {...props} outcome="unknown" listed={byOutcome.unknown} limit={4} />
      {rule &&
        (access ? (
          <DatasetRule
            rule={rule}
            data={access.data}
            {...(litCase ? { decided: litCase } : {})}
            className="block"
          >
            <PolicyRuleSection policy={policy} litPair={litPair} marked={litCase !== undefined} />
          </DatasetRule>
        ) : (
          <RuleHost rule={rule} className="block">
            <PolicyRuleSection policy={policy} litPair={undefined} marked={false} />
          </RuleHost>
        ))}
    </>
  )
}

/** A Policy's rule in words, in the case of the pair lit; its walk and its Figure on the stage. */
function PolicyRuleSection({
  policy,
  litPair,
  marked,
}: {
  policy: PolicyRule
  litPair: PolicyPair | undefined
  marked: boolean
}) {
  return (
    <Section label="Rule" kind={DATA_SECTIONS.rule} data-policy-rule="">
      <div className="text-[13px] leading-relaxed">
        <Reading />
      </div>
      {litPair && marked && <Meta data-policy-rule-case="">Read for {litPair.sentence}</Meta>}
      <Staged label="Show the walk and its Figure">
        <RuleStage title={policy.name} tone="who" marked={marked} />
      </Staged>
    </Section>
  )
}

function PairSection({
  outcome,
  listed,
  limit,
  ...props
}: DataPanelProps & {
  policy: PolicyRule
  outcome: PolicyPair['outcome']
  listed: readonly PolicyPair[]
  limit: number
}) {
  if (listed.length === 0) return null
  return (
    <Section
      label={OUTCOME_MARKS[outcome].admits}
      kind={OUTCOME_MARKS[outcome]}
      count={listed.length}
      data-pair-outcome={outcome}
    >
      <Fold
        items={listed}
        limit={limit}
        className="-mx-2"
        render={(pair) => <PairRow key={pair.id} {...props} pair={pair} />}
      />
    </Section>
  )
}

/**
 * One pair: the sentence, why as its own case — the Edges that admit it, or the condition that
 * fails first — and its light. Lit, its Edges wear the walk's numbers, and it says what the
 * Kernel decides for it at each place the Policy sits on, each verdict pinnable as a step asked
 * by the pair's identity.
 */
function PairRow(props: DataPanelProps & { policy: PolicyRule; pair: PolicyPair }) {
  const { pair, policy, access, pinning } = props
  const id = `${PAIR}${pair.id}`
  const lit = props.lit === id
  const mark = OUTCOME_MARKS[pair.outcome]
  const explained = useMemo(
    () => (access ? pairCase(access, policy, pair) : undefined),
    [access, pair, policy],
  )
  const verdict = explained?.status === 'explained' ? explained : undefined
  const rule = policy.reading.status === 'read' ? policy.reading.rule : undefined
  const caseOf = useMemo<DecidedCase | undefined>(
    () =>
      verdict
        ? {
            situation: verdict.verdict.situation,
            ...(verdict.verdict.fact === undefined ? {} : { fact: verdict.verdict.fact }),
          }
        : undefined,
    [verdict],
  )
  const numbers = useWalkNumbers(lit, rule, access?.data, caseOf)
  const verdicts = useMemo(
    () => (lit && access ? pairVerdicts(access, policy, pair, props.identity) : []),
    [access, lit, pair, policy, props.identity],
  )
  const asked = pinning ? { ...pinning, as: pair.identity ?? pinning.as } : undefined
  return (
    <div
      data-policy-pair={pair.id}
      data-outcome={pair.outcome}
      data-lit={lit ? '' : undefined}
      className={cn('space-y-1.5 rounded-md px-2 py-1.5', lit && 'bg-accent/60')}
    >
      <div className="flex items-start gap-2">
        <DataMark
          mark={{ ...mark, word: mark.admits }}
          className="mt-0.5 h-4 w-4"
          data-outcome-mark={pair.outcome}
        />
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed">{pair.sentence}</p>
        <button
          type="button"
          data-pair-light={pair.id}
          aria-pressed={lit}
          title={
            lit
              ? 'Lit on the map, with the verdicts it gets'
              : 'Light it on the map, and read the verdicts it gets'
          }
          onClick={() => props.onLight(id)}
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            lit ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <Lightbulb className="h-3.5 w-3.5" />
        </button>
      </div>
      {pair.why && <Meta className="pl-6">{pair.why}</Meta>}
      {verdict?.failing && (
        <Meta className="pl-6" data-pair-failing="">
          {verdict.failing}
        </Meta>
      )}
      {verdict && pair.outcome === 'allowed' && (
        <PathList
          path={verdict.path}
          tone="who"
          className="pl-6"
          data-pair-path=""
          {...(numbers ? { numbers } : {})}
        />
      )}
      {explained?.status === 'unexplained' && pair.outcome !== 'unknown' && (
        <Meta className="pl-6" data-pair-unexplained="">
          {explained.detail}
        </Meta>
      )}
      {lit && (
        <div data-pair-verdicts="" className="space-y-1 pl-6">
          <Meta>
            {verdicts.length > 0
              ? 'Where it sits, the Kernel decides:'
              : 'No place it sits on reads, traverses or calls this: no step can pin it.'}
          </Meta>
          {verdicts.map((one) => (
            <VerdictRow
              key={one.id}
              verdict={one}
              domainId={props.domainId}
              origin={props.model.origin}
              lit={false}
              {...(asked ? { pinning: asked } : {})}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Whether a verdict list holds the read verdict of a path, as the panel's default lit verdict. */
export function defaultLit(decided: Decided | undefined): string | undefined {
  if (!decided) return undefined
  return decided.kind === 'node' ? decided.read.id : decided.traverse.id
}
