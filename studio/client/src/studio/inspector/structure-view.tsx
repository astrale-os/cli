/**
 * The Structure lens of the Inspector: what exists. A Class's place in the Schema, its
 * Properties, then the relationships it stands in; a relationship's two ends, then its Properties. Methods, call rules
 * and Policies are other questions and never appear here.
 */
import { AnchorButton } from '@/components/anchor'

import { TONE_COLOR } from '../canvas/tones'
import { StateDiagram } from '../state-diagram/state-diagram'
import { ClassGlyph, CountMark, LifetimeMark } from './marks'
import {
  ClassChip,
  ClassName,
  Disclosure,
  Empty,
  Fact,
  Fold,
  Joined,
  Meta,
  Phrases,
  Section,
  sentenceText,
  Sublabel,
  useAnchorReveal,
  ValueHead,
  ValueNote,
} from './parts'
import {
  type ClassStructure,
  type DeletionLine,
  type EndLine,
  type PropertyLine,
  type RelationshipLine,
  type RelationshipStructure,
  type Structure,
} from './structure'

/** What a Class or relationship is made of, after the title block. */
export function StructureView({
  structure,
  holds,
  domainId,
}: {
  structure: Structure
  /** its constraints beyond its ends and marks, in the reader's words */
  holds: readonly string[]
  domainId: string
}) {
  return (
    <>
      <Lineage structure={structure} domainId={domainId} />
      {structure.kind === 'relationship' && (
        <RelationshipBody structure={structure} worded={holds.length > 0} domainId={domainId} />
      )}
      <Properties structure={structure} domainId={domainId} />
      {structure.kind === 'class' && <ClassBody structure={structure} domainId={domainId} />}
      {holds.length > 0 && (
        <Section label="Constraints" kind="constraints" count={holds.length}>
          <ul data-inspector-holds="" className="space-y-2 text-[13px] leading-relaxed">
            {holds.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        </Section>
      )}
      {structure.kind === 'class' && <WhenDeleted structure={structure} domainId={domainId} />}
    </>
  )
}

/** What it extends: its parents as links, then the bases above them, quieter. */
function Lineage({ structure, domainId }: { structure: Structure; domainId: string }) {
  if (structure.parents.length === 0) return null
  return (
    <div data-class-ancestry="" className="-mt-3 space-y-1.5">
      <Fact label="Extends">
        <Joined
          items={structure.parents.map((parent) => (
            <ClassName key={parent.target} link={parent} domainId={domainId} />
          ))}
        />
        {structure.ancestors.length > 0 && (
          <span className="text-[12px] text-muted-foreground">
            {' '}
            · and through {structure.parents.length === 1 ? 'it' : 'them'}{' '}
            <Joined
              items={structure.ancestors.map((ancestor) => (
                <ClassName key={ancestor.target} link={ancestor} domainId={domainId} />
              ))}
            />
          </span>
        )}
      </Fact>
    </div>
  )
}

// ── a Class ──

function ClassBody({ structure, domainId }: { structure: ClassStructure; domainId: string }) {
  const own = structure.relationships.filter((line) => line.through === undefined)
  const inherited = structure.relationships.filter((line) => line.through !== undefined)
  const through = [
    ...new Map(inherited.map((line) => [line.through!.target, line.through!])).values(),
  ]
  return (
    <Section
      label="Relationships"
      kind="relationships"
      count={structure.relationships.length || undefined}
      data-inspector-relationships=""
    >
      {structure.relationships.length === 0 ? (
        <Empty>None.</Empty>
      ) : (
        <div className="space-y-4">
          {own.length > 0 && (
            <Fold
              items={own}
              render={(line) => (
                <Relationship
                  key={`${line.relationship.target}:${line.end}`}
                  line={line}
                  names={[structure.name]}
                  domainId={domainId}
                />
              )}
            />
          )}
          {through.map((base) => {
            const lines = inherited.filter((line) => line.through!.target === base.target)
            return (
              <div key={base.target} className="space-y-2">
                <Sublabel>
                  As a <ClassName link={base} domainId={domainId} />
                </Sublabel>
                <Fold
                  items={lines}
                  limit={3}
                  render={(line) => (
                    <Relationship
                      key={`${line.relationship.target}:${line.end}`}
                      line={line}
                      names={[structure.name, base.name]}
                      domainId={domainId}
                    />
                  )}
                />
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

/** A role that only repeats the Class's name (`host` on Host) says nothing the sentence does not. */
const repeats = (role: string, names: readonly string[]) =>
  names.some((name) => role.replace(/_/g, '').toLowerCase() === name.toLowerCase())

/**
 * One relationship from the Class's end, drawn as marks: the relationship's glyph, what it says
 * (`is assigned to`), how many as the Schema writes it, the other end's Classes as chips; under
 * it, quieter, the relationship's name, the end's role when it says more than the Class's name,
 * and its constraints. The sentence it says is read on hover.
 */
function Relationship({
  line,
  names,
  domainId,
}: {
  line: RelationshipLine
  /** the Class and the base it is reached through: a role equal to one of them is not repeated */
  names: readonly string[]
  domainId: string
}) {
  const { says } = line
  return (
    <div
      data-inspector-relationship={line.relationship.target}
      data-inspector-end-at={line.end}
      title={sentenceText(line.sentence)}
      className="space-y-0.5"
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-5">
        <ClassGlyph link={line.relationship} className="text-[14px]" />
        <span data-relationship-verb="">{says.verb}</span>
        <CountMark count={says.count} />
        {says.role !== undefined && <span>{says.role}</span>}
        {says.others.map((other) => (
          <ClassChip key={other.target} link={other} domainId={domainId} />
        ))}
      </div>
      <Meta className="pl-[20px]">
        <ClassName link={line.relationship} domainId={domainId} mono glyph={false} />
        {!repeats(line.role, names) && (
          <>
            {' · as '}
            <span className="font-mono text-[11.5px]">{line.role}</span>
          </>
        )}
        {line.endAccepts !== undefined && <> · its end accepts {line.endAccepts} Classes</>}
        {line.constraints.length > 0 && <> · {line.constraints.join(' · ')}</>}
      </Meta>
    </div>
  )
}

// ── when one is deleted ──

/**
 * What deleting one of the Class's Nodes does to the links it stands in, as the Kernel's
 * lifetimes say: the links that refuse the deletion unless the same change deletes them, then
 * those that go with it. Over the relationships of the Domain on screen.
 */
function WhenDeleted({ structure, domainId }: { structure: ClassStructure; domainId: string }) {
  const { deletion, name } = structure
  const count = deletion ? deletion.restricts.length + deletion.detaches.length : 0
  return (
    <Section
      label="When deleted"
      kind="deletion"
      count={count || undefined}
      data-inspector-deletion={deletion === undefined ? 'unread' : ''}
    >
      {deletion === undefined ? (
        <Empty>Not read: this reading carries no canonical Schema.</Empty>
      ) : count === 0 ? (
        <Empty>Deleting one unlinks nothing.</Empty>
      ) : (
        <div className="space-y-4">
          {deletion.restricts.length > 0 && (
            <div className="space-y-2" data-inspector-deletion-group="restrict">
              <Sublabel>
                <span className="inline-flex items-center gap-1.5">
                  <LifetimeMark lifetime="restrict" />
                  Refused while it has one, unless the same change deletes the link
                </span>
              </Sublabel>
              <Fold
                items={deletion.restricts}
                limit={5}
                render={(line) => (
                  <DeletionRow
                    key={`${line.relationship.target}:${line.role}`}
                    line={line}
                    name={name}
                    domainId={domainId}
                  />
                )}
              />
            </div>
          )}
          {deletion.detaches.length > 0 && (
            <div className="space-y-2" data-inspector-deletion-group="detach">
              <Sublabel>
                <span className="inline-flex items-center gap-1.5">
                  <LifetimeMark lifetime="detach" />
                  Unlinked with it
                </span>
              </Sublabel>
              <Fold
                items={deletion.detaches}
                limit={5}
                render={(line) => (
                  <DeletionRow
                    key={`${line.relationship.target}:${line.role}`}
                    line={line}
                    name={name}
                    domainId={domainId}
                  />
                )}
              />
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

/** One link a deletion meets: the relationship and the Classes at its other end; under it, how. */
function DeletionRow({
  line,
  name,
  domainId,
}: {
  line: DeletionLine
  name: string
  domainId: string
}) {
  const notes = [
    ...(line.through ? [`as a ${line.through.name}`] : []),
    ...(repeats(line.role, line.through ? [name, line.through.name] : [name])
      ? []
      : [`at its ${line.role} end`]),
    ...(line.any ? ['which accepts any Node'] : []),
    ...(line.always ? [`every ${name} has one`] : []),
    ...(line.declared ? ['declared'] : []),
  ]
  return (
    <div
      data-inspector-deletion-row={line.relationship.target}
      data-inspector-deletion-role={line.role}
      className="space-y-0.5"
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-5">
        <ClassName link={line.relationship} domainId={domainId} mono />
        <span className="text-muted-foreground">with</span>
        {line.others.map((other) => (
          <ClassChip key={other.target} link={other} domainId={domainId} />
        ))}
      </div>
      {notes.length > 0 && <Meta className="pl-[20px]">{notes.join(' · ')}</Meta>}
    </div>
  )
}

// ── a relationship ──

const END_LABEL = { source: 'From', target: 'To' } as const

/** What a lifetime does when a Node at the end is deleted, as the Kernel defines it. */
const LIFETIME_WORDS = {
  detach: 'Deleting a Node here deletes the link with it.',
  restrict:
    'Deleting a Node here is refused while it has this link, unless the same change deletes the link.',
} as const

function RelationshipBody({
  structure,
  worded,
  domainId,
}: {
  structure: RelationshipStructure
  /** whether "Constraints" says them in the reader's words: they are said once */
  worded: boolean
  domainId: string
}) {
  return (
    <>
      <div data-inspector-says="" className="space-y-1.5 text-[14px] leading-relaxed">
        {structure.sentences.map((sentence, index) => (
          <p key={index}>
            <Phrases phrases={sentence} domainId={domainId} />.
          </p>
        ))}
      </div>
      <Section label="Ends" kind="ends" data-inspector-ends="">
        <div className="divide-y divide-border/60">
          {structure.ends.map((end) => (
            <End
              key={end.end}
              end={end}
              label={
                structure.directed
                  ? END_LABEL[end.end]
                  : end.end === 'source'
                    ? 'One end'
                    : 'Other end'
              }
              domainId={domainId}
            />
          ))}
        </div>
        {structure.constraints.length > 0 && !worded && (
          <Meta>Declared {structure.constraints.join(' and ')}.</Meta>
        )}
      </Section>
    </>
  )
}

/** An end: the Classes it accepts as chips, how many links each has; its role under them. */
function End({ end, label, domainId }: { end: EndLine; label: string; domainId: string }) {
  return (
    <div data-inspector-end={end.end} className="flex gap-3 py-2.5 first:pt-0">
      <span className="w-[4.5rem] shrink-0 pt-0.5 text-[12px] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1">
          {end.accepts.map((link) => (
            <ClassChip key={link.target} link={link} domainId={domainId} />
          ))}
        </div>
        <Meta className="flex flex-wrap items-center gap-x-1.5">
          <span className="font-mono text-[11.5px]">{end.role}</span>
          <span>·</span>
          <span>each has</span>
          <CountMark count={end.count} />
          <span>{end.count.words.endsWith(' one') ? 'such link' : 'such links'}</span>
          {end.lifetime !== undefined && (
            <>
              <span>·</span>
              <span
                data-inspector-lifetime={end.lifetime.lifetime}
                className="inline-flex items-center gap-1"
                title={LIFETIME_WORDS[end.lifetime.lifetime]}
              >
                <LifetimeMark lifetime={end.lifetime.lifetime} />
                {end.lifetime.lifetime === 'restrict' ? 'restricts' : 'detaches'}
                {end.lifetime.declared ? ' (declared)' : ''}
              </span>
            </>
          )}
        </Meta>
      </div>
    </div>
  )
}

// ── Properties ──

function Properties({ structure, domainId }: { structure: Structure; domainId: string }) {
  const own = structure.properties.filter((line) => line.from === undefined)
  const inherited = structure.properties.filter((line) => line.from !== undefined)
  const bases = [...new Map(inherited.map((line) => [line.from!.target, line.from!])).values()]
  if (structure.properties.length === 0)
    return (
      <Section label="Properties" kind="properties">
        <Empty>None.</Empty>
      </Section>
    )
  return (
    <Section
      label="Properties"
      kind="properties"
      count={structure.properties.length}
      data-inspector-properties=""
    >
      {own.length > 0 ? (
        <Fold
          items={own}
          limit={10}
          rows
          render={(line) => (
            <Property key={line.anchor} line={line} owner={structure.name} domainId={domainId} />
          )}
        />
      ) : (
        <Empty>None of its own.</Empty>
      )}
      {bases.map((base) => {
        const lines = inherited.filter((line) => line.from!.target === base.target)
        return (
          <Disclosure
            key={base.target}
            label={
              <>
                {lines.length} inherited from {base.name}
                {base.domain === undefined ? '' : ` (${base.domain})`}
              </>
            }
          >
            <div className="divide-y divide-border/60">
              {lines.map((line) => (
                <Property
                  key={line.anchor}
                  line={line}
                  owner={structure.name}
                  domainId={domainId}
                />
              ))}
            </div>
          </Disclosure>
        )
      })}
    </Section>
  )
}

/**
 * A Property: its kind's mark, its name (required: heavier, marked), its type and other marks;
 * under it, quieter, what it says of itself and its states when it has a machine.
 */
function Property({
  line,
  owner,
  domainId,
}: {
  line: PropertyLine
  /** the Class or relationship it is a Property of */
  owner: string
  domainId: string
}) {
  const reveal = useAnchorReveal(line.anchor, line.name)
  const required = line.marks.some((mark) => mark.kind === 'required')
  return (
    <div
      {...reveal}
      data-inspector-property={line.name}
      data-required={required || undefined}
      className="group/row space-y-0.5 py-1.5 first:pt-0"
    >
      <ValueHead
        name={line.name}
        value={line}
        required={required}
        marks={line.marks}
        domainId={domainId}
      >
        <AnchorButton
          domainId={domainId}
          anchorRef={{ ref: line.anchor, kind: 'schema' }}
          excerpt={line.name}
          className="self-center"
        />
      </ValueHead>
      {line.description !== undefined && <ValueNote text={line.description} />}
      {line.state !== undefined && <States state={line.state} title={`${owner} · ${line.name}`} />}
    </div>
  )
}

/**
 * A machine: its states and transitions as one small diagram, opened large on demand. A machine
 * that declares no transition is its states as chips, the initial one marked.
 */
function States({ state, title }: { state: NonNullable<PropertyLine['state']>; title: string }) {
  if (state.transitions.length > 0)
    return (
      <div className="pl-6 pt-1.5" data-property-states="">
        <StateDiagram machine={state} title={title} expandable />
      </div>
    )
  return (
    <div className="flex flex-wrap gap-1 pl-6 pt-1" data-property-states="">
      {state.states.map((name) => {
        const initial = name === state.initial
        return (
          <span
            key={name}
            data-state-chip={name}
            data-initial={initial || undefined}
            title={initial ? `${name}: where every one starts` : name}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2 font-mono text-[11px] leading-[18px]"
            style={
              initial
                ? {
                    borderColor: `color-mix(in oklch, ${TONE_COLOR.transition} 45%, transparent)`,
                  }
                : undefined
            }
          >
            {initial && (
              <span
                aria-label="initial"
                role="img"
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: TONE_COLOR.transition }}
              />
            )}
            {name}
          </span>
        )
      })}
    </div>
  )
}
