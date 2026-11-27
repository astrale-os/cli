/**
 * The Inspector: one page whose content is a function of the selection and the lens. The title
 * block is the selection's, the same under every lens; the body answers the lens's question
 * about it; the foot offers the other questions, each with what makes it worth asking. A
 * change of lens keeps the selection: it is another question about the same thing. A View has
 * one page under every lens: what it is, what its code reaches, and how to open it.
 */
import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { Braces, MousePointerClick, PenLine, Plug, Search, Workflow, Zap } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'

import { EmptyState } from '@/components/studio-kit'
import { useUI } from '@/lib/store'

import type { CallableLink } from './behavior'

import { rulesOf } from '../rules/model'
import { type Behavior, behaviorOf } from './behavior'
import {
  ClassBehaviorView,
  DefinitionBehaviorView,
  DefinitionFacts,
  FunctionBehaviorView,
  FunctionFacts,
  IntegrationBehaviorView,
  IntegrationFacts,
} from './behavior-view'
import { ClassGlyph } from './marks'
import { Empty, LensSwitches, Page, Section, Title } from './parts'
import { RulesView } from './rules-view'
import { classLink, holdsOf, structureOf } from './structure'
import { StructureView } from './structure-view'
import { switchesOf } from './switches'
import { anchorOf, type InspectorTarget, targetOf } from './target'
import { ViewPage, ViewsBody } from './views-view'
import { NO_TERMS, termsOf } from './words'

export function Inspector({ bundle, selected }: { bundle: StudioSchemaBundle; selected?: string }) {
  const lens = useUI((state) => state.lens)
  const rules = rulesOf(bundle)
  const terms = useMemo(
    () => (rules.catalogue === undefined ? NO_TERMS : termsOf(rules.catalogue)),
    [rules],
  )
  const target = useMemo(
    () => (selected === undefined ? undefined : targetOf(bundle, selected)),
    [bundle, selected],
  )
  const structure = useMemo(
    () => (target?.kind === 'class' ? structureOf(bundle, target.ref, terms) : undefined),
    [bundle, target, terms],
  )
  const behavior = useMemo(
    () => (target === undefined ? undefined : behaviorOf(bundle, target, terms)),
    [bundle, target, terms],
  )
  const switches = useMemo(
    () => (target === undefined ? [] : switchesOf(bundle, target, rules, lens, terms)),
    [bundle, target, rules, lens, terms],
  )
  const domainId = bundle.domainId

  if (bundle.ir === null || target === undefined)
    return (
      <div data-inspector="" className="flex h-full items-center justify-center px-6">
        <EmptyState
          icon={<MousePointerClick />}
          title="Nothing selected"
          hint="Pick a Class, relationship or function on the canvas to read it here."
        />
      </div>
    )
  if (target.kind === 'missing')
    return (
      <div data-inspector="" className="flex h-full items-center justify-center px-6">
        <EmptyState
          title="Not in this Schema"
          hint={`${target.id} is not declared by the compiled Schema.`}
        />
      </div>
    )
  if (target.kind === 'view') return <ViewPage bundle={bundle} slug={target.slug} />

  const heading = headingOf(bundle, target, structure, behavior)
  const users = usersOf(behavior)
  return (
    <Page
      domainId={domainId}
      data-comment-outline-inset=""
      data-inspector-lens={lens}
      data-anchor-ref={anchorOf(target)}
      data-anchor-excerpt={heading.name}
      data-commentable=""
    >
      <Title
        kicker={heading.kicker}
        name={heading.name}
        mono={heading.mono}
        icon={heading.icon}
        {...(heading.description === undefined ? {} : { description: heading.description })}
        domainId={domainId}
        anchor={anchorOf(target)}
        {...(heading.file === undefined ? {} : { file: heading.file })}
      />
      {behavior?.kind === 'function' && <FunctionFacts behavior={behavior} domainId={domainId} />}
      {behavior?.kind === 'definition' && (
        <DefinitionFacts behavior={behavior} domainId={domainId} />
      )}
      {behavior?.kind === 'integration' && <IntegrationFacts behavior={behavior} />}
      {lens === 'structure' ? (
        structure !== undefined ? (
          <StructureView
            structure={structure}
            holds={holdsOf(rules, target.id)}
            domainId={domainId}
          />
        ) : (
          <Section label="Structure">
            <Empty>
              {target.kind === 'function'
                ? 'A function adds nothing to what exists: its input, output, writes and reaches are behavior.'
                : target.kind === 'integration'
                  ? 'An Integration adds nothing to what exists: what it offers and who reaches it is behavior.'
                  : 'A mutation or query adds nothing to what exists: what it does is behavior.'}
            </Empty>
          </Section>
        )
      ) : lens === 'behavior' ? (
        <BehaviorBody behavior={behavior} domainId={domainId} />
      ) : lens === 'views' ? (
        <ViewsBody bundle={bundle} target={target} />
      ) : (
        <RulesView
          bundle={bundle}
          target={target}
          rules={rules}
          users={users}
          domainId={domainId}
        />
      )}
      <LensSwitches switches={switches} />
    </Page>
  )
}

function BehaviorBody({
  behavior,
  domainId,
}: {
  behavior: Behavior | undefined
  domainId: string
}) {
  switch (behavior?.kind) {
    case 'class':
      return <ClassBehaviorView behavior={behavior} domainId={domainId} />
    case 'function':
      return <FunctionBehaviorView behavior={behavior} domainId={domainId} />
    case 'definition':
      return <DefinitionBehaviorView behavior={behavior} domainId={domainId} />
    case 'integration':
      return <IntegrationBehaviorView behavior={behavior} domainId={domainId} />
    default:
      return null
  }
}

/** The functions that reach a mutation, query or Integration: whose call rules decide who may. */
function usersOf(behavior: Behavior | undefined): CallableLink[] {
  if (behavior?.kind === 'definition') return [...behavior.usedBy]
  if (behavior?.kind === 'integration')
    return [
      ...new Map(
        behavior.operations.flatMap((operation) => operation.users).map((each) => [each.key, each]),
      ).values(),
    ]
  return []
}

interface Heading {
  readonly kicker: string
  readonly name: string
  readonly mono: boolean
  readonly icon: ReactNode
  readonly description?: string
  readonly file?: string
}

const KIND_WORD = { action: 'Action', workflow: 'Workflow' } as const

function headingOf(
  bundle: StudioSchemaBundle,
  target: Exclude<InspectorTarget, { kind: 'missing' | 'view' }>,
  structure: ReturnType<typeof structureOf>,
  behavior: Behavior | undefined,
): Heading {
  switch (target.kind) {
    case 'class': {
      const relationship = structure?.kind === 'relationship'
      const kind = relationship
        ? 'Relationship'
        : structure?.roles.includes('identity')
          ? 'Identity'
          : 'Class'
      return {
        kicker: [kind, structure?.module, structure?.domain]
          .filter((each) => each !== undefined)
          .join(' · '),
        name: target.ref.name,
        mono: relationship,
        icon: <ClassGlyph link={classLink(bundle, target.ref)} className="h-3.5 w-3.5" />,
        ...(structure?.description === undefined ? {} : { description: structure.description }),
        ...(structure?.file === undefined ? {} : { file: structure.file }),
      }
    }
    case 'function': {
      const fn = behavior?.kind === 'function' ? behavior : undefined
      const flavor = fn?.flavor === undefined ? undefined : KIND_WORD[fn.flavor]
      return {
        kicker: [
          target.owner === undefined ? 'Function' : `Method of ${target.owner}`,
          flavor ?? (target.abstract ? 'Contract' : undefined),
        ]
          .filter((each) => each !== undefined)
          .join(' · '),
        name: target.key,
        mono: true,
        icon:
          fn?.flavor === 'workflow' ? <Workflow /> : fn?.flavor === 'action' ? <Zap /> : <Braces />,
        ...(fn?.description === undefined ? {} : { description: fn.description }),
        ...(fn?.source === undefined ? {} : { file: fn.source.file }),
      }
    }
    case 'definition':
      return {
        kicker: target.definition.kind === 'query' ? 'Query' : 'Mutation',
        name: target.definition.id,
        mono: true,
        icon: target.definition.kind === 'query' ? <Search /> : <PenLine />,
        ...(target.definition.doc === undefined ? {} : { description: target.definition.doc }),
        file: target.definition.file,
      }
    case 'integration':
      return {
        kicker: 'Integration',
        name: target.integration.key,
        mono: true,
        icon: <Plug />,
        ...(target.integration.doc === undefined ? {} : { description: target.integration.doc }),
        ...(target.integration.file === undefined ? {} : { file: target.integration.file }),
      }
  }
  return { kicker: '', name: bundle.domainId, mono: false, icon: null }
}
