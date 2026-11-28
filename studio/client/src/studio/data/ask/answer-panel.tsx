/**
 * What the panel reads beside a question: the Query, what it was asked with and what it answers,
 * row by row as its tree of reads nests them; or, with no Query open, the dataset measured
 * against its Schema, Class by Class and end by end.
 */

import type { DefinitionLink, StudioSchemaBundle } from '@shared/contracts/schema'

import { Sparkles } from 'lucide-react'
import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'

import type { DatasetModel } from '../model'
import type { Why } from './fill'
import type { ClassMeasure, Measure, RelationMeasure } from './measure'
import type { Slot } from './question'
import type { Answer, AnswerRow } from './run'
import type { QueryShape, ShapeStep } from './shape'

import { ClassGlyph } from '../../inspector/marks'
import { Empty, Fact, Fold, Meta, Section, Title } from '../../inspector/parts'
import { classLinkOf, DATA_SECTIONS } from '../marks'
import { admittedSentence, datasetLabel, nodeId } from '../model'
import { whyWords } from './fill'
import { spreadWords } from './measure'
import { stepLabel, titleOf } from './question'
import { plural } from './question-bar'
import { counted } from './scenes'
import { stepOf } from './shape'

function Pick({
  onPick,
  children,
  mono = false,
}: {
  onPick: () => void
  children: ReactNode
  mono?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onPick()
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

function NodeName({
  model,
  path,
  onSelect,
}: {
  model: DatasetModel
  path: string
  onSelect: (id: string) => void
}) {
  const cls = model.classOf.get(path)
  return (
    <span className="whitespace-nowrap">
      {cls && (
        <ClassGlyph link={classLinkOf(cls)} className="mr-[0.3em] inline-block align-[-0.15em]" />
      )}
      <Pick onPick={() => onSelect(nodeId(path))}>{model.nodes.get(path)?.label ?? path}</Pick>
    </span>
  )
}

/** One row of the answer: the Node, then what it holds under each step of the tree. */
function RowView({ row, depth, props }: { row: AnswerRow; depth: number; props: AnswerPageProps }) {
  return (
    <div className={cn('space-y-1 text-[13px] leading-relaxed', depth === 0 && 'py-2')}>
      <NodeName model={props.model} path={row.path} onSelect={props.onSelect} />
      {row.children.map((group) => {
        const step = stepOf(props.shape, group.step)!
        const nested = group.rows.some((child) => child.children.length > 0)
        return (
          <div key={group.step} className="flex gap-2 pl-4 text-[12.5px] leading-relaxed">
            <span className="w-20 shrink-0 truncate pt-px text-[11.5px] text-muted-foreground">
              {stepLabel(props.bundle, step)}
            </span>
            <span className="min-w-0 flex-1">
              {nested ? (
                <span className="block space-y-1">
                  {group.rows.map((child) => (
                    <RowView
                      key={`${child.path}:${child.edge}`}
                      row={child}
                      depth={depth + 1}
                      props={props}
                    />
                  ))}
                </span>
              ) : (
                group.rows.map((child, index) => (
                  <span key={`${child.path}:${child.edge}`}>
                    {index > 0 && <span className="text-muted-foreground">, </span>}
                    <NodeName model={props.model} path={child.path} onSelect={props.onSelect} />
                  </span>
                ))
              )}
              {group.more > 0 && (
                <span className="text-muted-foreground">
                  {group.rows.length > 0 ? ' and ' : ''}
                  {counted(group.more)} more
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** The tree of what the Query reads, each step with the Nodes the answer holds there. */
function ReadsTree({
  step,
  depth,
  bundle,
  answer,
}: {
  step: ShapeStep
  depth: number
  bundle: StudioSchemaBundle
  answer: Answer
}) {
  const held = answer.perStep.get(step.id) ?? 0
  return (
    <>
      <div
        className="flex items-baseline gap-2 text-[12.5px] leading-relaxed"
        style={{ paddingLeft: depth * 14 }}
      >
        <span className="min-w-0 flex-1 truncate">
          {step.via && (
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {step.via.ref.name} →{' '}
            </span>
          )}
          <span className="font-medium">{step.ref.name}</span>
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{counted(held)}</span>
      </div>
      {step.children.map((child) => (
        <ReadsTree key={child.id} step={child} depth={depth + 1} bundle={bundle} answer={answer} />
      ))}
    </>
  )
}

export interface AnswerPageProps {
  domainId: string
  bundle: StudioSchemaBundle
  model: DatasetModel
  definition: DefinitionLink
  shape: QueryShape
  slots: readonly Slot[]
  values: Readonly<Record<string, readonly string[]>>
  picked: Readonly<Record<string, Why>>
  answer: Answer
  /** who asks, in words; none when the dataset is read whole */
  asLabel?: string
  approximate: readonly string[]
  onSelect: (id: string) => void
}

export function AnswerPage(props: AnswerPageProps) {
  const { definition, answer, shape, slots, model } = props
  const root = shape.roots[0]
  const labelOf = (path: string) => model.nodes.get(path)?.label ?? path
  return (
    <>
      <Title
        kicker={root ? `Query · ${plural(root.ref.name, 2)}` : 'Query'}
        name={titleOf(definition)}
        description={definition.doc}
        domainId={props.domainId}
        anchor={`query.${definition.id}`}
        file={definition.file}
      >
        <div className="space-y-1">
          <Fact label="Id">
            <span className="font-mono text-[12px]">{definition.id}</span>
          </Fact>
          <Fact label="Source">
            <span className="font-mono text-[12px]">
              {definition.file}:{definition.line}
            </span>
          </Fact>
          <Fact label="Read as">{props.asLabel ?? 'the Domain: everything the dataset holds'}</Fact>
        </div>
      </Title>

      <Section label="Asked with" kind={DATA_SECTIONS.variables} count={slots.length}>
        {slots.length === 0 ? (
          <Empty>The Query takes nothing.</Empty>
        ) : (
          <div className="space-y-1.5">
            {slots.map((slot) => {
              const held = props.values[slot.id] ?? []
              const why = props.picked[slot.id]
              return (
                <div key={slot.id} className="text-[13px] leading-relaxed">
                  <span className="font-mono text-[12px] text-muted-foreground">{slot.label}</span>{' '}
                  {held.length === 0 ? (
                    <span className="italic text-muted-foreground">
                      {slot.optional ? 'any' : 'none'}
                    </span>
                  ) : slot.kind === 'value' ? (
                    <span className="font-medium">{held[0]}</span>
                  ) : (
                    held.map((path, index) => (
                      <span key={path}>
                        {index > 0 && ', '}
                        <NodeName model={model} path={path} onSelect={props.onSelect} />
                      </span>
                    ))
                  )}
                  {why !== undefined && held.length > 0 && (
                    <Meta className="flex items-start gap-1">
                      <Sparkles aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-primary/80" />
                      picked for you: {labelOf(held[0]!)}, {whyWords(why)}
                    </Meta>
                  )}
                  {!slot.applied && <Meta className="text-warning">shown, not applied</Meta>}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section
        label="Answer"
        kind={DATA_SECTIONS.nodes}
        count={answer.matched}
        data-ask-answer={String(answer.matched)}
      >
        {answer.matched === 0 ? (
          <Empty>
            Nothing matches{props.asLabel ? `, as ${props.asLabel} may read it` : ''}. Free a slot,
            or ask as another identity.
          </Empty>
        ) : (
          <>
            <Fold
              items={answer.rows}
              limit={12}
              rows
              render={(row) => <RowView key={row.path} row={row} depth={0} props={props} />}
            />
            {answer.matched > answer.rows.length && (
              <Meta>
                {counted(answer.matched - answer.rows.length)} more rows match, not listed.
              </Meta>
            )}
          </>
        )}
        {answer.hidden > 0 && (
          <Meta className="text-warning">
            {counted(answer.hidden)} {answer.hidden === 1 ? 'Node is' : 'Nodes are'} reached and
            withheld{props.asLabel ? ` from ${props.asLabel}` : ''}.
          </Meta>
        )}
        {answer.clipped && (
          <Meta>The map draws the first {counted(answer.nodes.size)} Nodes reached.</Meta>
        )}
      </Section>

      <Section label="What it reads" kind="relationships" count={shape.steps.length}>
        <div className="space-y-0.5">
          {shape.roots.map((step) => (
            <ReadsTree key={step.id} step={step} depth={0} bundle={props.bundle} answer={answer} />
          ))}
        </div>
      </Section>

      <Section label="Approximate" hint="the Studio runs no Kernel">
        <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-muted-foreground">
          {props.approximate.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>
    </>
  )
}

function EndsLine({ relation }: { relation: RelationMeasure }) {
  if (!relation.ends) return null
  return (
    <Meta>
      {relation.ends.map((end, index) => {
        const broken = end.below > 0 || end.above > 0
        return (
          <span key={end.name} className={cn(broken && 'text-warning')}>
            {index > 0 && ' · '}
            each {end.name} has {spreadWords(end)}
            {broken &&
              ` (${counted(end.below + end.above)} ${end.below + end.above === 1 ? 'breaks' : 'break'} what it declares)`}
          </span>
        )
      })}
    </Meta>
  )
}

export interface MeasurePageProps {
  domainId: string
  model: DatasetModel
  measure: Measure
  factor: number
  /** the Class selected on the measure, by its selection id */
  selected?: ClassMeasure
  /** the Queries that start from the Class selected */
  starting: readonly DefinitionLink[]
  onSelect: (id: string | undefined) => void
  onQuery: (id: string) => void
}

export function MeasurePage(props: MeasurePageProps) {
  const { model, measure, selected } = props
  const dataset = model.dataset
  const relations = [...measure.relations.values()].sort((left, right) => right.edges - left.edges)
  if (selected) {
    const about = relations.filter((relation) =>
      relation.ends?.some((end) => end.nodes > 0 && relation.edges > 0),
    )
    return (
      <>
        <Title
          kicker="Class · measured"
          name={selected.name}
          domainId={props.domainId}
          anchor={selected.target}
        >
          <Fact label="Holds">
            {counted(selected.nodes)} {selected.nodes === 1 ? 'Node' : 'Nodes'} in this dataset
          </Fact>
        </Title>
        <Section
          label="Queries that start from it"
          kind={DATA_SECTIONS.variables}
          count={props.starting.length}
        >
          {props.starting.length === 0 ? (
            <Empty>No Query of the Domain starts from this Class.</Empty>
          ) : (
            <div className="space-y-1.5">
              {props.starting.map((definition) => (
                <div key={definition.id} className="text-[13px] leading-relaxed">
                  <Pick onPick={() => props.onQuery(definition.id)}>{titleOf(definition)}</Pick>
                  {definition.doc && <Meta>{definition.doc}</Meta>}
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section label="Relationships" kind="relationships" count={about.length}>
          <Fold
            items={about}
            limit={10}
            rows
            render={(relation) => (
              <div key={relation.target} className="py-1.5 text-[13px] leading-relaxed">
                <span className="font-mono text-[12px]">{relation.name}</span>{' '}
                <span className="tabular-nums text-muted-foreground">
                  {counted(relation.edges)} {relation.edges === 1 ? 'Edge' : 'Edges'}
                </span>
                <EndsLine relation={relation} />
              </div>
            )}
          />
        </Section>
      </>
    )
  }
  const classes = [...measure.classes.values()].sort((left, right) => right.nodes - left.nodes)
  return (
    <>
      <Title
        kicker="Dataset · measured"
        name={datasetLabel(dataset)}
        description={dataset.description}
        domainId={props.domainId}
        anchor={`dataset.${dataset.id}`}
      >
        <div className="space-y-1">
          <Fact label="Module">
            <span className="font-mono text-[12px]">{dataset.path}</span>
          </Fact>
          <Fact label="Holds">
            {counted(measure.nodes)} Nodes, {counted(measure.edges)} Edges, {classes.length} Classes
          </Fact>
          <Fact label="Schema">{admittedSentence(dataset)}</Fact>
          {props.factor > 1 && (
            <Fact label="Size">
              <span className="text-warning">
                Faked: the dataset as written, laid down {props.factor} times with its identities
                shared.
              </span>
            </Fact>
          )}
        </div>
      </Title>
      <Section label="Classes" kind={DATA_SECTIONS.classes} count={classes.length}>
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {classes.map((cls) => (
              <tr key={cls.target} className="border-t border-border/60 first:border-t-0">
                <td className="py-1.5">
                  <Pick onPick={() => props.onSelect(cls.target)}>{cls.name}</Pick>
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {counted(cls.nodes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section
        label="Relationships"
        kind="relationships"
        count={relations.length}
        hint={
          measure.breaches > 0 ? (
            <span className="text-warning">
              {measure.breaches} {measure.breaches === 1 ? 'end' : 'ends'} broken
            </span>
          ) : undefined
        }
      >
        <Fold
          items={relations}
          limit={10}
          rows
          render={(relation) => (
            <div key={relation.target} className="py-1.5 text-[13px] leading-relaxed">
              <Pick mono onPick={() => props.onSelect(relation.target)}>
                {relation.name}
              </Pick>{' '}
              <span className="tabular-nums text-muted-foreground">
                {counted(relation.edges)} {relation.edges === 1 ? 'Edge' : 'Edges'}
              </span>
              <EndsLine relation={relation} />
            </div>
          )}
        />
      </Section>
    </>
  )
}
