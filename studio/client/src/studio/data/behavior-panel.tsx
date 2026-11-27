/**
 * The Data level's panel through the Behavior lens: the dataset's Scenarios. With none it says
 * what a Scenario is and opens the way to its first step; with some it lists each with its
 * standing. A Scenario open reads its steps as sentences — what is not as expected first, with
 * what was expected, what is found and its proof — and each step is moved, noted, flipped or
 * deleted in place. A call step lists what its function is declared to write and the
 * preconditions its mutations state, in the Schema's sections, words, marks and tones: nothing of
 * it is applied, and none of them is checked. A standing wears its mark (`STANDING_MARKS`), a
 * verdict the Schema's mark for its operation and whom its rule admits.
 */

import type { Scenario } from '@shared/contracts/scenarios'

import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronLeft,
  ListChecks,
  Pencil,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { toast } from 'sonner'

import { UnreadableState } from '@/components/unreadable-state'
import { cn } from '@/lib/utils'

import type { Phrase } from '../inspector/structure'
import type { DatasetModel } from './model'
import type { DeclaredChange, JudgedScenario, JudgedStep, Standing } from './scenarios'
import type { DatasetScenarios } from './use-scenarios'

import { TONE_TEXT } from '../canvas/tones'
import { type EffectRow, Effects, Preconditions } from '../inspector/effects'
import {
  CallableName,
  ClassName,
  Empty,
  Fact,
  Fold,
  Joined,
  Meta,
  Page,
  Section,
} from '../inspector/parts'
import { callableTargetOf } from '../inspector/target'
import { withArticle } from '../inspector/words'
import { classLinkOf, DATA_SECTIONS, DataMark, STANDING_MARKS } from './marks'
import { datasetLabel } from './model'
import { expecting, moved, noted, renamed, withoutStep, withStep } from './scenario-edits'
import { PathList, VerdictBy } from './verdict-parts'
import { verdictView } from './verdict-view'

/** Said once, on every Scenario: what a step is judged on, and what is never done. */
export const SCENARIO_LIMIT =
  'Each step is judged on the dataset as written; writes are listed as declared, not applied.'

export interface BehaviorPanelProps {
  domainId: string
  model: DatasetModel
  /** every Scenario of the dataset, judged for its standing */
  judged: readonly JudgedScenario[]
  /** the Scenario open, judged with each verdict's proof */
  open?: JudgedScenario
  /** the step selected, by id */
  step?: string
  scenarios: DatasetScenarios
  onOpen: (scenario: string | undefined) => void
  onStep: (step: JudgedStep | undefined) => void
  /** selects the step and reads it in the Rules lens */
  onRules: (step: JudgedStep) => void
  /** opens the Rules lens on a Node whose verdicts can be pinned */
  onFirstStep: () => void
}

export function BehaviorPanel(props: BehaviorPanelProps) {
  const { open } = props
  return (
    <Page
      key={open ? `scenario.${open.scenario.id}` : '@scenarios'}
      domainId={props.domainId}
      data-data-panel=""
    >
      {open ? <ScenarioPage {...props} open={open} /> : <ScenariosPage {...props} />}
    </Page>
  )
}

// ── marks ──

/** A Scenario's standing as a whole: any step not as expected or gone, then can't tell, then as expected. */
function standingOf(judged: JudgedScenario): Standing {
  if (judged.broken.length > 0) return 'unexpected'
  return judged.counts.unknown > 0 ? 'unknown' : 'expected'
}

/** A Scenario's standing in words, its mark before them. */
function ScenarioStanding({ judged }: { judged: JudgedScenario }) {
  const mark = STANDING_MARKS[standingOf(judged)]
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <DataMark mark={mark} className="h-3.5 w-3.5" data-scenario-mark={standingOf(judged)} />
      <span
        data-scenario-standing=""
        className={cn('tabular-nums', judged.broken.length > 0 && TONE_TEXT[mark.tone])}
      >
        {judged.standing}
      </span>
    </span>
  )
}

/** A row's controls take no arrow, Home or End away from the page, and Esc stays theirs. */
function keepKeys(event: KeyboardEvent<HTMLElement>, onEscape: () => void, onEnter?: () => void) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    onEscape()
    return
  }
  if (event.key === 'Enter' && onEnter) {
    event.preventDefault()
    onEnter()
  }
  if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) event.stopPropagation()
}

function TextEdit({
  initial,
  label,
  multiline = false,
  max,
  onSave,
  onCancel,
  ...rest
}: {
  initial: string
  label: string
  multiline?: boolean
  max: number
  onSave: (text: string) => void
  onCancel: () => void
} & Record<`data-${string}`, string>) {
  const [text, setText] = useState(initial)
  const className =
    'w-full rounded-md border bg-background px-2 py-1 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
  const common = {
    'aria-label': label,
    autoFocus: true,
    maxLength: max,
    value: text,
    onBlur: () => onSave(text),
    ...rest,
  }
  return multiline ? (
    <textarea
      {...common}
      rows={2}
      className={cn(className, 'resize-none leading-relaxed')}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) =>
        keepKeys(event, onCancel, event.metaKey || event.ctrlKey ? () => onSave(text) : undefined)
      }
    />
  ) : (
    <input
      {...common}
      className={className}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => keepKeys(event, onCancel, () => onSave(text))}
    />
  )
}

function IconButton({
  label,
  onClick,
  children,
  disabled = false,
  ...rest
}: {
  label: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
} & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40 disabled:hover:bg-transparent"
      {...rest}
    >
      {children}
    </button>
  )
}

function Header({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <header className="space-y-2.5">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <ListChecks aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{kicker}</span>
      </div>
      {children}
    </header>
  )
}

// ── no Scenario open ──

function ScenariosPage({ model, judged, scenarios, onOpen, onFirstStep }: BehaviorPanelProps) {
  return (
    <>
      <Header kicker="Scenarios">
        <h2 className="break-words text-[18px] font-semibold leading-tight tracking-tight">
          {datasetLabel(model.dataset)}
        </h2>
      </Header>
      {scenarios.unreadable ? (
        <UnreadableState
          file={scenarios.unreadable}
          what="The Scenarios"
          onRetry={scenarios.retry}
        />
      ) : scenarios.error ? (
        <p data-scenarios-error="" role="alert" className="text-[13px] text-destructive">
          The Scenarios could not be read: {scenarios.error}
        </p>
      ) : judged.length === 0 ? (
        <section data-scenario-empty="" className="space-y-3">
          <p className="text-[13px] leading-relaxed">
            A Scenario is a list of steps on this dataset. Each step says who acts — one of its
            identities, or anyone — what they do — read or traverse a Node or an Edge, or call a
            function — and whether that is expected allowed or refused.
          </p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Each step is judged again whenever the Schema or the dataset changes, and a step no
            longer as expected is the first thing its Scenario shows. A step is written by pinning a
            verdict the Rules lens decides.
          </p>
          <button
            type="button"
            data-scenario-first=""
            onClick={onFirstStep}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            Pin the first step from Rules →
          </button>
        </section>
      ) : (
        <Section label="Scenarios" kind={DATA_SECTIONS.scenarios} count={judged.length}>
          <div className="divide-y divide-border/60">
            {judged.map((one) => (
              <button
                key={one.scenario.id}
                type="button"
                data-scenario-row={one.scenario.id}
                onClick={() => onOpen(one.scenario.id)}
                className="flex w-full items-baseline gap-2 rounded-sm py-2 text-left text-[13px] transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{one.scenario.name}</span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  <ScenarioStanding judged={one} />
                </span>
              </button>
            ))}
          </div>
          <Meta>A step is added by pinning a verdict the Rules lens decides.</Meta>
        </Section>
      )}
    </>
  )
}

// ── a Scenario ──

function ScenarioPage(props: BehaviorPanelProps & { open: JudgedScenario }) {
  const { open, scenarios, onOpen, onStep, step: selected } = props
  const scenario = open.scenario
  const [renaming, setRenaming] = useState(false)

  /** Edits the Scenario as it stands now, never as this render last saw it. */
  const edit = (change: (current: Scenario) => Scenario) => {
    const current = scenarios.get(scenario.id)
    if (current) scenarios.put(change(current))
  }
  const deleteScenario = () => {
    const removed = scenarios.remove(scenario.id)
    if (!removed) return
    onOpen(undefined)
    toast(`Scenario ${removed.name} deleted`, {
      action: { label: 'Undo', onClick: () => scenarios.put(removed) },
    })
  }
  const actions: StepActions = {
    move: (judged, by) => edit((current) => moved(current, judged.step.id, by)),
    flip: (judged) => {
      const before = judged.step.expect
      const after = before === 'allowed' ? 'refused' : 'allowed'
      edit((current) => expecting(current, judged.step.id, after))
      toast(`Step ${judged.number} now expects ${after}`, {
        action: {
          label: 'Undo',
          onClick: () => edit((current) => expecting(current, judged.step.id, before)),
        },
      })
    },
    note: (judged, text) => edit((current) => noted(current, judged.step.id, text)),
    remove: (judged) => {
      const at = scenario.steps.findIndex((one) => one.id === judged.step.id)
      edit((current) => withoutStep(current, judged.step.id))
      if (selected === judged.step.id) onStep(undefined)
      toast(`Step ${judged.number} deleted`, {
        description: judged.ask,
        action: {
          label: 'Undo',
          onClick: () => edit((current) => withStep(current, judged.step, at)),
        },
      })
    },
  }

  return (
    <>
      <Header kicker={`Scenario · ${datasetLabel(props.model.dataset)}`}>
        <div className="flex items-start gap-1">
          {renaming ? (
            <TextEdit
              initial={scenario.name}
              label="Scenario name"
              max={120}
              data-scenario-name-input=""
              onSave={(text) => {
                setRenaming(false)
                if (text.trim() && text.trim() !== scenario.name)
                  edit((current) => renamed(current, text))
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <>
              <h2
                data-scenario-name=""
                className="min-w-0 flex-1 break-words text-[18px] font-semibold leading-tight tracking-tight"
              >
                {scenario.name}
              </h2>
              <IconButton label="Rename" data-scenario-rename="" onClick={() => setRenaming(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
            </>
          )}
        </div>
        <p data-scenario-limit="" className="text-[12px] leading-relaxed text-muted-foreground">
          {SCENARIO_LIMIT}
        </p>
        <div className="space-y-1">
          <Fact label="Standing">
            <ScenarioStanding judged={open} />
          </Fact>
        </div>
        <button
          type="button"
          data-scenario-back=""
          onClick={() => onOpen(undefined)}
          className="inline-flex items-center gap-1 rounded-sm text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Every Scenario of this dataset
        </button>
      </Header>

      {open.broken.length > 0 && (
        <Section
          label={STANDING_MARKS.unexpected.word}
          kind={STANDING_MARKS.unexpected}
          count={open.broken.length}
          data-scenario-broken=""
        >
          <div className="space-y-2">
            {open.broken.map((judged) => (
              <BrokenRow
                key={judged.step.id}
                judged={judged}
                origin={props.model.origin}
                domainId={props.domainId}
                selected={selected === judged.step.id}
                onStep={onStep}
              />
            ))}
          </div>
        </Section>
      )}

      <Section
        label="Steps"
        kind={DATA_SECTIONS.scenarios}
        count={open.steps.length}
        data-scenario-steps=""
      >
        {open.steps.length === 0 ? (
          <Empty>
            This Scenario holds no step: pin a verdict the Rules lens decides to add the first.
          </Empty>
        ) : (
          <ol className="space-y-1">
            {open.steps.map((judged) => (
              <StepRow
                key={judged.step.id}
                model={props.model}
                domainId={props.domainId}
                onStep={onStep}
                onRules={props.onRules}
                judged={judged}
                last={open.steps.length}
                selected={selected === judged.step.id}
                actions={actions}
              />
            ))}
          </ol>
        )}
      </Section>

      <div className="border-t pt-4">
        <button
          type="button"
          data-scenario-delete=""
          onClick={deleteScenario}
          className="inline-flex items-center gap-1.5 rounded-sm text-[12px] text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete this Scenario
        </button>
      </div>
    </>
  )
}

interface StepActions {
  move: (judged: JudgedStep, by: number) => void
  flip: (judged: JudgedStep) => void
  note: (judged: JudgedStep, text: string) => void
  remove: (judged: JudgedStep) => void
}

/** `1 · Kernel reads 354iwg4avm6wdmrs — allowed, as expected`, its mark before it. */
function StepSentence({ judged, numbered = true }: { judged: JudgedStep; numbered?: boolean }) {
  const mark = STANDING_MARKS[judged.standing]
  return (
    <span className="flex min-w-0 flex-1 items-start gap-2">
      <DataMark mark={mark} className="mt-0.5 h-4 w-4" data-step-mark={judged.standing} />
      <span data-step-sentence="" className="min-w-0 flex-1 text-[13px] leading-relaxed">
        {numbered && <span className="tabular-nums text-muted-foreground">{judged.number} · </span>}
        {judged.ask} —{' '}
        <span className={cn(judged.standing !== 'expected' && TONE_TEXT[mark.tone])}>
          {judged.answer}
        </span>
      </span>
    </span>
  )
}

/** What a step not as expected shows first: expected, found, and the proof found. */
function BrokenRow({
  judged,
  origin,
  domainId,
  selected,
  onStep,
}: {
  judged: JudgedStep
  origin: string
  domainId: string
  selected: boolean
  onStep: (step: JudgedStep | undefined) => void
}) {
  return (
    <div
      data-broken-step={judged.step.id}
      className={cn('space-y-1.5 rounded-md py-1.5 pl-2 pr-1', selected && 'bg-accent/60')}
    >
      <button
        type="button"
        onClick={() => onStep(judged)}
        className="flex w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <StepSentence judged={judged} />
      </button>
      <div className="space-y-1 pl-6">
        <Fact label="Expected">{judged.step.expect}</Fact>
        <Fact label="Found">
          {judged.standing === 'gone' ? judged.reason : (judged.verdict?.outcome ?? "can't tell")}
        </Fact>
        {judged.verdict && <Proof judged={judged} origin={origin} domainId={domainId} />}
      </div>
    </div>
  )
}

/** The verdict a step finds: its operation and whom the rule admits, by which rule, why, and through which Edges. */
function Proof({
  judged,
  origin,
  domainId,
}: {
  judged: JudgedStep
  origin: string
  domainId: string
}) {
  if (!judged.verdict) return null
  const view = verdictView(judged.verdict, origin)
  return (
    <div data-step-proof="" className="space-y-1">
      <VerdictBy view={view} domainId={domainId} />
      {view.path.length > 0 && <PathList path={view.path} tone={view.op} data-step-path="" />}
    </div>
  )
}

function StepRow({
  judged,
  last,
  selected,
  actions,
  model,
  domainId,
  onStep,
  onRules,
}: Pick<BehaviorPanelProps, 'model' | 'domainId' | 'onStep' | 'onRules'> & {
  judged: JudgedStep
  last: number
  selected: boolean
  actions: StepActions
}) {
  const [noting, setNoting] = useState(false)
  const { step } = judged
  const other = step.expect === 'allowed' ? 'refused' : 'allowed'
  return (
    <li
      data-step={step.id}
      data-standing={judged.standing}
      data-expect={step.expect}
      data-selected={selected ? '' : undefined}
      className={cn('space-y-1.5 rounded-md py-1.5 pl-2 pr-1', selected && 'bg-accent/60')}
    >
      <button
        type="button"
        data-step-select={step.id}
        aria-pressed={selected}
        onClick={() => onStep(selected ? undefined : judged)}
        className="flex w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <StepSentence judged={judged} />
      </button>
      {step.note && !noting && (
        <p
          data-step-note-text=""
          className="pl-6 text-[12px] italic leading-relaxed text-muted-foreground"
        >
          {step.note}
        </p>
      )}
      {judged.reason && judged.standing === 'unknown' && (
        <Meta className="pl-6">{judged.reason}</Meta>
      )}
      {selected && (
        <div className="space-y-2.5 pl-6">
          {noting && (
            <TextEdit
              initial={step.note ?? ''}
              label="Note"
              multiline
              max={280}
              data-step-note-input=""
              onSave={(text) => {
                setNoting(false)
                if (text.trim() !== (step.note ?? '')) actions.note(judged, text)
              }}
              onCancel={() => setNoting(false)}
            />
          )}
          {judged.standing === 'expected' && judged.verdict && (
            <Proof judged={judged} origin={model.origin} domainId={domainId} />
          )}
          {judged.declared && <Declared judged={judged} domainId={domainId} model={model} />}
          <div className="flex flex-wrap items-center gap-0.5">
            <IconButton
              label="Move up"
              data-step-up=""
              disabled={judged.number === 1}
              onClick={() => actions.move(judged, -1)}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label="Move down"
              data-step-down=""
              disabled={judged.number === last}
              onClick={() => actions.move(judged, 1)}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label={step.note ? 'Edit the note' : 'Add a note'}
              data-step-note=""
              onClick={() => setNoting(true)}
            >
              <StickyNote className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label="Delete the step"
              data-step-delete=""
              onClick={() => actions.remove(judged)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
            <button
              type="button"
              data-step-flip=""
              onClick={() => actions.flip(judged)}
              className="ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Expect {other}
            </button>
            <button
              type="button"
              data-step-rules=""
              onClick={() => onRules(judged)}
              className="ml-auto rounded-sm px-1 text-[12px] font-medium text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Rules →
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * What a call's function is declared to write, write by write, and what its mutations require
 * before they write: the Schema's Writes and Preconditions, in its words, marks and tones.
 */
function Declared({
  judged,
  domainId,
  model,
}: {
  judged: JudgedStep
  domainId: string
  model: DatasetModel
}) {
  const declared = judged.declared!
  const fn = judged.step.does === 'call' ? judged.step.fn : ''
  return (
    <div data-step-declared="" className="space-y-3">
      <Section
        label="Writes"
        kind="writes"
        count={declared.changes.length || undefined}
        tally={[...new Set(declared.changes.map((change) => change.verb))]}
        hint="declared, not applied"
      >
        {declared.changes.length === 0 && declared.gaps.length > 0 && (
          <Meta>The reading of {fn} names no write it can tell.</Meta>
        )}
        <Effects
          effects={declared.changes.map((change) => declaredRow(change, model, domainId))}
          gaps={declared.gaps}
          domainId={domainId}
          empty={`${fn} is declared to write nothing.`}
        />
      </Section>
      {declared.preconditions.length > 0 && (
        <Section
          label="Preconditions"
          kind="preconditions"
          count={declared.preconditions.length}
          hint={<span data-preconditions-limit="">read from source, not checked</span>}
          data-step-preconditions=""
        >
          <Preconditions
            preconditions={declared.preconditions}
            mutations={declared.several}
            domainId={domainId}
          />
        </Section>
      )}
      <Meta>
        From the source of{' '}
        <CallableName
          target={callableTargetOf(fn)}
          name={fn}
          glyph="function"
          domainId={domainId}
        />
        .
      </Meta>
    </div>
  )
}

/** One declared write as an effect, its Classes as the Schema marks them, and where it would land. */
function declaredRow(change: DeclaredChange, model: DatasetModel, domainId: string): EffectRow {
  const lands = landsOf(change, model, domainId)
  const classes = change.classes.flatMap((link, index): Phrase[] => [
    ...(index > 0 ? [index === change.classes.length - 1 ? ' or ' : ', '] : []),
    { link, text: link.name },
  ])
  return {
    kind: change.verb,
    verb: change.verb,
    words: classes.length > 0 ? [`${change.word} `, ...classes] : [change.word],
    names: change.relationships,
    ...(change.moves.length > 0 ? { aside: change.moves.join(', ') } : {}),
    ...(lands ? { note: lands } : {}),
  }
}

/** Where in the dataset a write would land: its regions, when they are not the Classes named. */
function landsOf(change: DeclaredChange, model: DatasetModel, domainId: string): ReactNode {
  const named = change.classes.map((link) => link.name)
  if (change.regions.length === 0)
    return `No Node of this dataset is ${withArticle(named.join(' or '))}.`
  const classes = change.regions.map((region) => model.classByTarget.get(region))
  if (
    classes.length === named.length &&
    classes.every((cls, i) => (cls?.name ?? change.regions[i]) === named[i])
  )
    return undefined
  return (
    <>
      In this dataset:{' '}
      <Joined
        items={classes.map((cls, i) =>
          cls ? (
            <ClassName key={cls.target} link={classLinkOf(cls)} domainId={domainId} />
          ) : (
            <span key={change.regions[i]} className="font-mono">
              {change.regions[i]}
            </span>
          ),
        )}
      />
      .
    </>
  )
}

// ── a Node or an Edge ──

/** The steps of the dataset's Scenarios that involve the Node or Edge selected. */
export function StepsInvolving({
  judged,
  involves,
  onStep,
  onFirstStep,
}: {
  judged: readonly JudgedScenario[]
  involves: (step: JudgedStep) => boolean
  onStep: (scenario: Scenario, step: JudgedStep) => void
  onFirstStep: () => void
}) {
  const steps = judged.flatMap((one) =>
    one.steps.filter(involves).map((step) => ({ scenario: one.scenario, step })),
  )
  return (
    <Section
      label="Scenario steps"
      kind={DATA_SECTIONS.scenarios}
      count={steps.length}
      data-steps-involving=""
    >
      {steps.length === 0 ? (
        <div className="space-y-2">
          <Empty>No step of this dataset's Scenarios involves it.</Empty>
          <button
            type="button"
            data-scenario-first=""
            onClick={onFirstStep}
            className="rounded-sm text-[12px] font-medium text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            Pin one of its verdicts from Rules →
          </button>
        </div>
      ) : (
        <Fold
          items={steps}
          limit={8}
          render={({ scenario, step }) => (
            <button
              key={`${scenario.id}.${step.step.id}`}
              type="button"
              data-involving-step={step.step.id}
              onClick={() => onStep(scenario, step)}
              className="flex w-full flex-col gap-0.5 rounded-md py-1 pl-2 pr-1 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="text-[11px] text-muted-foreground">{scenario.name}</span>
              <StepSentence judged={step} />
            </button>
          )}
        />
      )}
    </Section>
  )
}
