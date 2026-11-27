/**
 * The Behavior lens of the Inspector: what happens. What changes a Class and how its state
 * moves; what a function takes, changes, reaches and calls; what a mutation or query does; what
 * an Integration offers and who reaches it. Where the source reading cannot follow, the page
 * says so instead of leaving it out.
 */
import type { SourceGap } from '@shared/contracts/schema'

import { useState } from 'react'

import { AnchorButton } from '@/components/anchor'

import type {
  CallableLink,
  ChangeBy,
  ChangeGroup,
  ClassBehavior,
  DefinitionBehavior,
  DefinitionRef,
  DefinitionStep,
  EffectLine,
  FieldLine,
  FunctionBehavior,
  IntegrationBehavior,
  Lifecycle,
  MethodLine,
  PreconditionLine,
} from './behavior'

import { TONE_COLOR } from '../canvas/tones'
import { arrangeWrites } from './behavior'
import { type EffectRow, Effects, Meets, meetsKey, Preconditions } from './effects'
import {
  CallableName,
  ClassName,
  Disclosure,
  Empty,
  Fact,
  Fold,
  Joined,
  Meta,
  Section,
  Sublabel,
  useAnchorReveal,
  ValueHead,
  ValueLine,
  ValueNote,
} from './parts'
import { opening, withArticle } from './words'

const plural = (count: number, one: string, other = `${one}s`) =>
  `${count} ${count === 1 ? one : other}`

/** Callables named in a sentence, joined as a sentence lists them. */
function Callables({ items, domainId }: { items: readonly CallableLink[]; domainId: string }) {
  return (
    <Joined
      limit={8}
      items={items.map((each) => (
        <CallableName
          key={each.key}
          target={each.target}
          name={each.key}
          glyph="function"
          domainId={domainId}
        />
      ))}
    />
  )
}

function Definitions({ items, domainId }: { items: readonly DefinitionRef[]; domainId: string }) {
  return (
    <Joined
      limit={8}
      items={items.map((each) => (
        <CallableName
          key={each.id}
          target={each.target}
          name={each.id}
          glyph={each.kind}
          domainId={domainId}
        />
      ))}
    />
  )
}

/** Callables a section lists on their own: one a line, as the Index names them. Long lists fold. */
function CallableList({
  items,
  domainId,
  limit = 8,
}: {
  items: readonly CallableLink[]
  domainId: string
  limit?: number
}) {
  const [open, setOpen] = useState(false)
  // a fold that would hide a single name hides nothing worth a click
  const shown = open || items.length <= limit + 1 ? items : items.slice(0, limit)
  return (
    <div className="flex flex-col items-start gap-y-0.5 text-[13px] leading-relaxed">
      {shown.map((each) => (
        <CallableName
          key={each.key}
          target={each.target}
          name={each.key}
          glyph="function"
          domainId={domainId}
        />
      ))}
      {shown.length < items.length && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-sm text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {items.length - shown.length} more
        </button>
      )}
    </div>
  )
}

/** A source location: `file:line`, quiet and selectable. */
/** Where a Publication's behavior would be read: what its bundle does not hold. */
const NO_HANDLERS = 'A published bundle holds no handler sources'

const where = (file: string, line?: number) => `${file}${line === undefined ? '' : `:${line}`}`

// ── a Class ──

export function ClassBehaviorView({
  behavior,
  domainId,
}: {
  behavior: ClassBehavior
  domainId: string
}) {
  const name = behavior.name
  return (
    <>
      <Section
        label={behavior.relationship ? 'What makes and removes it' : 'What writes it'}
        kind="writes"
        tally={behavior.groups.map((group) => group.verb)}
        data-inspector-changes=""
      >
        {!behavior.handlers ? (
          <Empty>
            {NO_HANDLERS}: what changes {withArticle(behavior.relationship ? `${name} link` : name)}{' '}
            is read from them.
          </Empty>
        ) : behavior.groups.length === 0 ? (
          <Empty>
            Nothing changes {withArticle(behavior.relationship ? `${name} link` : name)}: no
            function writes it.
          </Empty>
        ) : (
          <div className="space-y-5">
            {behavior.groups.map((group) => (
              <Group key={group.verb} group={group} domainId={domainId} />
            ))}
          </div>
        )}
      </Section>
      {behavior.lifecycles.map((lifecycle) => (
        <LifecycleView key={lifecycle.property} lifecycle={lifecycle} domainId={domainId} />
      ))}
      {behavior.methods.length > 0 && (
        <Section
          label="Methods"
          kind="methods"
          count={behavior.methods.length}
          data-inspector-methods=""
        >
          <Fold
            items={behavior.methods}
            limit={8}
            rows
            render={(method) => <Method key={method.fn.key} method={method} domainId={domainId} />}
          />
        </Section>
      )}
      {behavior.functions.length > 0 && (
        <Section label="Functions that take it" kind="functions" count={behavior.functions.length}>
          <CallableList items={behavior.functions} domainId={domainId} />
        </Section>
      )}
      {behavior.readers.length > 0 && (
        <Section label="Read without changing it" kind="reads" count={behavior.readers.length}>
          <CallableList items={behavior.readers} domainId={domainId} />
        </Section>
      )}
      {(behavior.unreached.length > 0 || behavior.untold.length > 0) && (
        <Section label="Can’t tell" kind="untold" data-inspector-untold="">
          <div className="space-y-2 text-[13px] leading-relaxed">
            {behavior.unreached.length > 0 && (
              <p>
                <Definitions items={behavior.unreached} domainId={domainId} />{' '}
                <span className="text-muted-foreground">
                  {behavior.unreached.length === 1 ? 'writes' : 'write'} it, but no function’s
                  handler is read to reach {behavior.unreached.length === 1 ? 'it' : 'them'}.
                </span>
              </p>
            )}
            {behavior.untold.length > 0 && (
              <Disclosure
                label={`${plural(behavior.untold.length, 'mutation')} name a Class the reading cannot tell: any of them may write it too`}
              >
                <p className="text-[13px] leading-relaxed">
                  <Definitions items={behavior.untold} domainId={domainId} />
                </p>
              </Disclosure>
            )}
          </div>
        </Section>
      )}
    </>
  )
}

/** One verb: the functions sure to make the change, then those that may. */
function Group({ group, domainId }: { group: ChangeGroup; domainId: string }) {
  return (
    <div data-inspector-change={group.verb} className="space-y-1.5">
      <Sublabel>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: TONE_COLOR[group.verb] }}
          />
          {group.label}
        </span>
      </Sublabel>
      {group.by.length > 0 && (
        <Fold
          items={group.by}
          limit={5}
          render={(by) => <Changer key={by.fn.key} by={by} domainId={domainId} />}
        />
      )}
      {group.may.length > 0 && (
        <Disclosure
          label={`${group.by.length > 0 ? `${group.may.length} more` : plural(group.may.length, 'function')} may: ${group.may.length === 1 ? 'its' : 'their'} mutations name it through a base or a shared end`}
        >
          <div className="space-y-2">
            {group.may.map((by) => (
              <Changer key={by.fn.key} by={by} domainId={domainId} />
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  )
}

function Changer({ by, domainId }: { by: ChangeBy; domainId: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[13px] leading-relaxed">
        <CallableName target={by.fn.target} name={by.fn.key} glyph="function" domainId={domainId} />
        {by.fn.kind !== undefined && (
          <span className="text-[12px] text-muted-foreground"> · {by.fn.kind}</span>
        )}
      </p>
      <Meta>
        {'with '}
        <Definitions items={by.definitions} domainId={domainId} />
        {by.relationships.length > 0 && (
          <>
            {' · writes '}
            <Joined
              items={by.relationships.map((link) => (
                <ClassName key={link.target} link={link} domainId={domainId} mono />
              ))}
            />
          </>
        )}
        {by.through !== undefined && (
          <>
            {' · names '}
            <ClassName link={by.through} domainId={domainId} />
          </>
        )}
      </Meta>
      {by.blocked?.map((meets) => (
        <Meets key={meetsKey(meets)} meets={meets} domainId={domainId} />
      ))}
    </div>
  )
}

/** The ways a state Property moves: each state it leaves, the steps out of it, and who makes each. */
function LifecycleView({ lifecycle, domainId }: { lifecycle: Lifecycle; domainId: string }) {
  const leaving = [
    ...new Set([...lifecycle.states, ...lifecycle.steps.map((step) => step.from)]),
  ].flatMap((state) => {
    const steps = lifecycle.steps.filter((step) => step.from === state)
    return steps.length === 0 ? [] : [{ state, steps }]
  })
  const quiet = (step: Lifecycle['steps'][number]) =>
    step.by.length === 0 && step.base.length === 0 && step.may.length === 0
  const silent = lifecycle.steps.filter(quiet).length
  return (
    <Section label="Lifecycle" kind="lifecycle" data-inspector-lifecycle={lifecycle.property}>
      <p className="text-[13px] leading-relaxed">
        <span className="font-mono text-[12.5px]">{lifecycle.property}</span>
        {lifecycle.initial !== undefined && (
          <>
            {' starts at '}
            <span className="font-mono text-[12.5px]">{lifecycle.initial}</span>
            {' and'}
          </>
        )}{' '}
        transitions through {plural(lifecycle.states.length, 'state')}
        {lifecycle.steps.length > 0 && <> by {plural(lifecycle.steps.length, 'declared step')}</>}.
      </p>
      {lifecycle.steps.length === 0 ? (
        <Empty>The Schema declares no step between its states.</Empty>
      ) : (
        <div className="divide-y divide-border/60">
          {leaving.map(({ state, steps }) => (
            <div key={state} data-lifecycle-state={state} className="flex gap-3 py-2 first:pt-0">
              <span
                className="w-[6.5rem] shrink-0 truncate font-mono text-[12px] leading-5"
                title={state}
              >
                {state}
              </span>
              <ul className="min-w-0 flex-1 space-y-1 text-[12.5px] leading-5">
                {steps.map((step) => {
                  const none = quiet(step)
                  return (
                    <li
                      key={`${step.event}:${step.to}`}
                      data-lifecycle-step={`${step.from}:${step.event}`}
                      className={none ? 'text-muted-foreground' : undefined}
                    >
                      <span className="text-muted-foreground">→ </span>
                      <span className="font-mono text-[12px]">{step.to}</span>
                      <span className="text-muted-foreground"> on </span>
                      <span className="font-mono text-[12px]">{step.event}</span>
                      {step.by.length > 0 && (
                        <>
                          <span className="text-muted-foreground"> · </span>
                          <Callables items={step.by} domainId={domainId} />
                        </>
                      )}
                      {step.base.map(({ fn, through }) => (
                        <span key={fn.key} className="text-muted-foreground">
                          {' · perhaps '}
                          <CallableName
                            target={fn.target}
                            name={fn.key}
                            glyph="function"
                            domainId={domainId}
                          />
                          {', which names '}
                          <ClassName link={through} domainId={domainId} />
                        </span>
                      ))}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {(lifecycle.loose.length > 0 || lifecycle.untold.length > 0 || silent > 0) && (
        <div className="space-y-1">
          {lifecycle.loose.map((loose) => (
            <Meta
              key={`${loose.reason}:${loose.by.map((each) => each.key).join()}`}
              data-lifecycle-loose=""
            >
              <Callables items={loose.by} domainId={domainId} /> may make any step on{' '}
              <Joined
                last="or"
                items={loose.events.map((event) => (
                  <span key={event} className="font-mono">
                    {event}
                  </span>
                ))}
              />
              {loose.reason === 'event'
                ? `: ${loose.by.length === 1 ? 'its mutations write' : 'their mutations write'} the event, not the state it leaves.`
                : `: ${loose.by.length === 1 ? 'its mutations write' : 'their mutations write'} the event, not the state it leaves, and name it only through a base.`}
            </Meta>
          ))}
          {lifecycle.untold.length > 0 && (
            <Meta>
              <Callables items={lifecycle.untold} domainId={domainId} />{' '}
              {lifecycle.untold.length === 1 ? 'transitions' : 'transition'} it by an event the
              reading cannot tell.
            </Meta>
          )}
          {silent > 0 && (
            <Meta>
              {silent === lifecycle.steps.length
                ? 'No function is read to make any of these steps.'
                : `No function is read to make the ${plural(silent, 'greyed step')}.`}
            </Meta>
          )}
        </div>
      )}
    </Section>
  )
}

function Method({ method, domainId }: { method: MethodLine; domainId: string }) {
  // an inherited contract is commented under the Class that declares it
  const anchor = `${method.from?.target ?? `class.${method.fn.key.slice(0, method.fn.key.indexOf('.'))}`}.method.${method.name}`
  const reveal = useAnchorReveal(anchor, method.fn.key)
  const marks = [
    method.fn.kind,
    method.static ? 'static' : undefined,
    method.abstract ? 'contract' : undefined,
  ].filter((mark) => mark !== undefined)
  return (
    <div
      {...reveal}
      data-method-row=""
      className="flex items-baseline gap-2.5 py-1.5 text-[13px] first:pt-0"
    >
      <CallableName
        target={method.open ? method.fn.target : undefined}
        name={method.name}
        glyph="function"
        domainId={domainId}
      />
      {method.from !== undefined && (
        <span className="text-[12px] text-muted-foreground">
          from <ClassName link={method.from} domainId={domainId} />
        </span>
      )}
      <span className="ml-auto text-[11px] text-muted-foreground">{marks.join(' · ')}</span>
      <AnchorButton
        domainId={domainId}
        anchorRef={{ ref: anchor, kind: 'schema' }}
        excerpt={method.fn.key}
        className="self-center"
      />
    </div>
  )
}

// ── a function ──

export function FunctionFacts({
  behavior,
  domainId,
}: {
  behavior: FunctionBehavior
  domainId: string
}) {
  const handler = !behavior.handlers
    ? `${NO_HANDLERS}.`
    : behavior.flavor === undefined
      ? behavior.abstract
        ? 'None: it is a contract, and each Class that implements it declares its own.'
        : 'None is linked: the Schema declares it, no source implements it yet.'
      : behavior.unlinked === true
        ? 'Declared, but its file was not found.'
        : behavior.implemented === false
          ? 'A stub: its handler is still todo().'
          : undefined
  return (
    <div className="-mt-3 space-y-1.5">
      {behavior.on.length > 0 && (
        <Fact
          label={
            behavior.static && behavior.on.length === 1 && behavior.key.includes('.')
              ? 'On'
              : 'Works on'
          }
        >
          <Joined
            items={behavior.on.map((link) => (
              <ClassName key={link.target} link={link} domainId={domainId} />
            ))}
          />
          {behavior.static && behavior.key.includes('.') && (
            <span className="text-muted-foreground"> · static</span>
          )}
        </Fact>
      )}
      <Fact label="Handler">
        {handler !== undefined ? (
          <span
            className={
              behavior.handlers && behavior.flavor === undefined && !behavior.abstract
                ? 'text-warning'
                : 'text-muted-foreground'
            }
          >
            {handler}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {behavior.flavor === undefined ? undefined : opening(withArticle(behavior.flavor))}
          </span>
        )}
        {behavior.source !== undefined && (
          <span className="block break-all font-mono text-[11.5px] text-muted-foreground">
            {where(behavior.source.file, behavior.source.line)}
          </span>
        )}
      </Fact>
      {behavior.kernelCalls.length > 0 && (
        <Fact label="Kernel">
          <span className="font-mono text-[12px]">{behavior.kernelCalls.join(', ')}</span>
        </Fact>
      )}
    </div>
  )
}

export function FunctionBehaviorView({
  behavior,
  domainId,
}: {
  behavior: FunctionBehavior
  domainId: string
}) {
  return (
    <>
      <Section
        label="Input"
        kind="input"
        count={behavior.input.length || undefined}
        data-method-input=""
      >
        {behavior.input.length === 0 ? (
          <Empty>Nothing.</Empty>
        ) : (
          <Fields fields={behavior.input} domainId={domainId} />
        )}
      </Section>
      <Section label="Output" kind="output" data-method-returns="">
        {behavior.output.fields.length > 0 ? (
          <>
            <Meta>{behavior.output.type}</Meta>
            <Fields fields={behavior.output.fields} limit={5} domainId={domainId} />
          </>
        ) : (
          <ValueLine value={behavior.output} domainId={domainId} />
        )}
      </Section>
      <Section
        label="Writes"
        kind="writes"
        count={behavior.changes.length || undefined}
        tally={[
          ...new Set(
            behavior.changes.flatMap((step) =>
              step.effects.flatMap((effect) => (effect.verb ? [effect.verb] : [])),
            ),
          ),
        ]}
        data-inspector-function-changes=""
      >
        {behavior.changes.length === 0 ? (
          <Empty>
            {!behavior.handlers
              ? `${NO_HANDLERS}: what it writes, reads and reaches is read from them.`
              : behavior.flavor === undefined
                ? 'Nothing is read: no handler is linked.'
                : 'Nothing: its handler reaches no mutation.'}
          </Empty>
        ) : (
          <>
            {behavior.changes.length > 1 && (
              <Meta>
                Each mutation’s effects in source order; the reading does not give the order between
                mutations.
              </Meta>
            )}
            <div className="space-y-4">
              {behavior.changes.map((step) => (
                <Step key={step.definition.id} step={step} domainId={domainId} />
              ))}
            </div>
          </>
        )}
      </Section>
      {behavior.preconditions.length > 0 && (
        <PreconditionsSection
          preconditions={behavior.preconditions}
          mutations={behavior.changes.length > 1}
          domainId={domainId}
        />
      )}
      {behavior.reads.length > 0 && (
        <Section label="Reads" kind="reads" count={behavior.reads.length}>
          <Fold
            items={behavior.reads}
            limit={3}
            render={(step) => <Step key={step.definition.id} step={step} domainId={domainId} />}
          />
        </Section>
      )}
      {behavior.reaches.length > 0 && (
        <Section
          label="Integrations"
          kind="integrations"
          count={behavior.reaches.length}
          data-inspector-reaches=""
        >
          <div className="space-y-2.5">
            {behavior.reaches.map((reach) => (
              <div key={`${reach.integration}.${reach.operation}`} className="space-y-0.5">
                <p className="text-[13px] leading-relaxed">
                  <CallableName
                    target={reach.target}
                    name={reach.integration}
                    glyph="integration"
                    domainId={domainId}
                  />
                  <span className="font-mono text-[0.92em]">.{reach.operation}</span>
                  {reach.label !== undefined && (
                    <span className="text-[12px] text-warning"> · {reach.label}</span>
                  )}
                </p>
                <Meta>{reach.meaning ?? 'Another attempt does nothing more.'}</Meta>
              </div>
            ))}
          </div>
        </Section>
      )}
      {(behavior.calls.length > 0 || behavior.calledBy.length > 0) && (
        <Section label="Calls" kind="calls">
          <div className="space-y-1.5 text-[13px] leading-relaxed">
            {behavior.calls.length > 0 && (
              <p>
                <Callables items={behavior.calls} domainId={domainId} />
              </p>
            )}
            {behavior.calls.length === 0 && <Empty>It calls no other function.</Empty>}
            {behavior.calledBy.length > 0 && (
              <p>
                <span className="text-muted-foreground">Called by </span>
                <Callables items={behavior.calledBy} domainId={domainId} />
              </p>
            )}
          </div>
        </Section>
      )}
      {behavior.untold.length > 0 && <Untold gaps={behavior.untold} />}
    </>
  )
}

/** Fields as rows, as a Class's Properties read: kind, name, required, type, what it says. Long lists fold. */
function Fields({
  fields,
  limit = 8,
  domainId,
}: {
  fields: readonly FieldLine[]
  limit?: number
  domainId: string
}) {
  return (
    <Fold
      items={fields}
      limit={limit}
      rows
      render={(field) => (
        <div
          key={field.name}
          data-field={field.name}
          data-required={field.required || undefined}
          className="space-y-0.5 py-1.5 first:pt-0"
        >
          <ValueHead
            name={field.name}
            value={field}
            required={field.required}
            domainId={domainId}
          />
          {field.description !== undefined && <ValueNote text={field.description} />}
        </div>
      )}
    />
  )
}

/** A mutation or query a handler reaches: its id, then what it does in source order. */
function Step({ step, domainId }: { step: DefinitionStep; domainId: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[13px] leading-relaxed">
        <CallableName
          target={step.definition.target}
          name={step.definition.id}
          glyph={step.definition.kind}
          domainId={domainId}
        />
      </p>
      <Effects
        effects={arrangeWrites(step.effects).map(rowOf)}
        gaps={reasons(step.gaps)}
        domainId={domainId}
        limit={WRITES_SHOWN}
        more={(count) => `${count} more writes`}
      />
    </div>
  )
}

/** What mutations require before they write, read from their source and checked against nothing. */
function PreconditionsSection({
  preconditions,
  mutations = false,
  domainId,
}: {
  preconditions: readonly PreconditionLine[]
  mutations?: boolean
  domainId: string
}) {
  return (
    <Section
      label="Preconditions"
      kind="preconditions"
      count={preconditions.length}
      hint="read from source, not checked"
      data-inspector-preconditions=""
    >
      <Preconditions preconditions={preconditions} mutations={mutations} domainId={domainId} />
    </Section>
  )
}

/** The rows a mutation's writes show before a fold that counts the rest. */
const WRITES_SHOWN = 8

/** An effect line as the shared rows read it. */
const rowOf = (effect: EffectLine): EffectRow => ({
  kind: effect.kind,
  ...(effect.verb ? { verb: effect.verb } : {}),
  words: effect.words,
  // two relationships between the same ends read alike: the name tells them apart
  ...(effect.relationship ? { names: [effect.relationship] } : {}),
  ...asideOf(effect),
  where: where(effect.file, effect.line),
  ...(effect.deletion ? { deletion: effect.deletion } : {}),
})

/** A link row standing for several writes: a self relationship's two roles, or how many. */
function asideOf({ selfRoles, times }: EffectLine): Pick<EffectRow, 'aside'> {
  if (selfRoles && times !== undefined)
    return { aside: `as ${selfRoles[0]} and as ${selfRoles[1]}` }
  if (selfRoles) return { aside: `as ${selfRoles[0]} or ${selfRoles[1]}` }
  return times === undefined ? {} : { aside: `${times} writes` }
}

const reasons = (gaps: readonly SourceGap[]) => gaps.map((gap) => gap.reason)

export function Untold({ gaps }: { gaps: readonly SourceGap[] }) {
  return (
    <Section label="Can’t tell" kind="untold" count={gaps.length} data-inspector-untold="">
      <ul className="space-y-1.5">
        {gaps.map((gap, index) => (
          <li key={index} className="text-[13px] leading-relaxed">
            {gap.reason}
            <span className="block break-all font-mono text-[11.5px] text-muted-foreground">
              {where(gap.file, gap.line)}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ── a mutation or query ──

export function DefinitionFacts({
  behavior,
  domainId,
}: {
  behavior: DefinitionBehavior
  domainId: string
}) {
  return (
    <div className="-mt-3 space-y-1.5">
      {behavior.name !== undefined && (
        <Fact label="Bound as">
          <span className="font-mono text-[12.5px]">{behavior.name}</span>
        </Fact>
      )}
      {behavior.names.length > 0 && (
        <Fact label="Names">
          <Joined
            items={behavior.names.map((link) => (
              <ClassName key={link.target} link={link} domainId={domainId} />
            ))}
          />
        </Fact>
      )}
      <Fact label="Declared">
        <span className="break-all font-mono text-[11.5px] text-muted-foreground">
          {where(behavior.source.file, behavior.source.line)}
        </span>
      </Fact>
    </div>
  )
}

export function DefinitionBehaviorView({
  behavior,
  domainId,
}: {
  behavior: DefinitionBehavior
  domainId: string
}) {
  return (
    <>
      <Section
        label={behavior.definition.kind === 'query' ? 'What it reads' : 'What it does'}
        kind={behavior.definition.kind === 'query' ? 'reads' : 'writes'}
        count={behavior.effects.length || undefined}
        data-inspector-effects=""
      >
        <Effects
          effects={(behavior.definition.kind === 'query'
            ? behavior.effects
            : arrangeWrites(behavior.effects)
          ).map(rowOf)}
          gaps={reasons(behavior.gaps)}
          domainId={domainId}
        />
      </Section>
      {behavior.preconditions.length > 0 && (
        <PreconditionsSection preconditions={behavior.preconditions} domainId={domainId} />
      )}
      <Section label="Used by" kind="functions" count={behavior.usedBy.length || undefined}>
        {behavior.usedBy.length === 0 ? (
          <Empty>No function’s handler is read to reach it.</Empty>
        ) : (
          <CallableList items={behavior.usedBy} domainId={domainId} />
        )}
      </Section>
    </>
  )
}

// ── an Integration ──

export function IntegrationFacts({ behavior }: { behavior: IntegrationBehavior }) {
  if (behavior.source === undefined && behavior.binding === undefined && behavior.id === undefined)
    return null
  return (
    <div className="-mt-3 space-y-1.5">
      {behavior.id !== undefined && (
        <Fact label="Id">
          <span className="font-mono text-[12.5px]">{behavior.id}</span>
        </Fact>
      )}
      {behavior.binding !== undefined && (
        <Fact label="Bound as">
          <span className="font-mono text-[12.5px]">{behavior.binding}</span>
        </Fact>
      )}
      {behavior.source !== undefined && (
        <Fact label="Declared">
          <span className="break-all font-mono text-[11.5px] text-muted-foreground">
            {where(behavior.source.file, behavior.source.line)}
          </span>
        </Fact>
      )}
    </div>
  )
}

export function IntegrationBehaviorView({
  behavior,
  domainId,
}: {
  behavior: IntegrationBehavior
  domainId: string
}) {
  return (
    <>
      <Section
        label="Operations"
        kind="integrations"
        count={behavior.operations.length || undefined}
      >
        {behavior.operations.length === 0 ? (
          <Empty>Its operations could not be read, and no function is read to reach one.</Empty>
        ) : (
          <div className="divide-y divide-border/60">
            {behavior.operations.map((operation) => (
              <div
                key={operation.name}
                data-integration-operation={operation.name}
                className="space-y-0.5 py-2 first:pt-0"
              >
                <p className="text-[13px] leading-relaxed">
                  <span className="font-mono text-[12.5px]">{operation.name}</span>
                  {operation.label !== undefined && (
                    <span className="text-[12px] text-warning"> · {operation.label}</span>
                  )}
                </p>
                {operation.meaning !== undefined && <Meta>{operation.meaning}</Meta>}
                <Meta>
                  {operation.users.length === 0 ? (
                    'No function is read to reach it.'
                  ) : (
                    <>
                      Reached by <Callables items={operation.users} domainId={domainId} />
                    </>
                  )}
                </Meta>
              </div>
            ))}
          </div>
        )}
        {!behavior.declared && behavior.operations.length > 0 && (
          <Meta>Its declaration was not read: these are the operations its users name.</Meta>
        )}
      </Section>
      {behavior.untold.length > 0 && (
        <Section label="Can’t tell" kind="untold" count={behavior.untold.length}>
          <Meta>
            These functions hand Integrations on where the reading cannot follow, so it cannot tell
            whether they reach this one.
          </Meta>
          <CallableList items={behavior.untold} domainId={domainId} />
        </Section>
      )}
    </>
  )
}
