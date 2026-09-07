/**
 * policy-words.tsx — a policy's rule, written out.
 *
 * The pattern language is a handful of shapes; each one gets a line a reader can follow
 * without knowing the DSL: `Subject —owns→ Object`, "there is a Group such that", "all of",
 * "any of". Terms wear the same words the canvas marks cards with.
 */
import type { IrSchemaRef } from '@shared/types'
import type { ReactNode } from 'react'

import { schemaRefKey } from '@shared/types'
import { ArrowRight, Box, Minus, UserRound } from 'lucide-react'

import {
  type Policy,
  type PolicyCheckObject,
  type PolicyIndex,
  type PolicyPattern,
  type PolicyTerm,
  isEdgeStep,
  policyLabel,
  variableClass,
} from '@/lib/policy'
import { cn } from '@/lib/utils'

/** The class each `exists` variable was declared with, by variable id. */
type VariableClasses = ReadonlyMap<number, IrSchemaRef>

/** "an Actor", "a Group" — a variable reads as one instance of its class. */
const anInstance = (name: string): string => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`

function TermChip({
  term,
  variables,
  origin,
}: {
  term: PolicyTerm
  variables: VariableClasses
  origin: string
}) {
  if (term.kind === 'variable') {
    const cls = variables.get(term.id)
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-px font-medium text-foreground/80">
        <Box className="h-3 w-3 text-muted-foreground" />
        {cls ? anInstance(policyLabel(cls, origin)) : `node ${term.id}`}
      </span>
    )
  }
  if (term.kind === 'ref')
    return (
      <span className="rounded-md bg-muted px-1.5 py-px font-medium">
        {term.ref.kind} {policyLabel(term.ref, origin)}
      </span>
    )
  const reserved: Record<
    Exclude<PolicyTerm, { kind: 'variable' | 'ref' }>['kind'],
    [string, ReactNode, string]
  > = {
    subject: ['Subject', <UserRound key="s" className="h-3 w-3" />, 'bg-primary/10 text-primary'],
    object: ['Object', <Box key="o" className="h-3 w-3" />, 'bg-schema-node/10 text-schema-node'],
    source: [
      'Edge source',
      <Box key="src" className="h-3 w-3" />,
      'bg-schema-edge/12 text-schema-edge',
    ],
    target: [
      'Edge target',
      <Box key="tgt" className="h-3 w-3" />,
      'bg-schema-edge/12 text-schema-edge',
    ],
  }
  const [label, icon, tone] = reserved[term.kind]
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-px font-medium', tone)}
    >
      {icon}
      {label}
    </span>
  )
}

function collectVariables(pattern: PolicyPattern, into: Map<number, IrSchemaRef>): void {
  if ('allOf' in pattern) pattern.allOf.forEach((p) => collectVariables(p, into))
  else if ('anyOf' in pattern) pattern.anyOf.forEach((p) => collectVariables(p, into))
  else if ('exists' in pattern) {
    for (const node of pattern.exists.nodes) {
      const cls = variableClass(node)
      if (cls) into.set(node.variable.id, cls)
    }
    collectVariables(pattern.exists.where, into)
  }
}

function Lines({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="ml-2 mt-1 flex flex-col gap-1.5 border-l pl-2.5">{children}</div>
    </div>
  )
}

export function PatternWords({
  pattern,
  origin,
  variables: outer,
  undirected,
}: {
  pattern: PolicyPattern
  origin: string
  variables?: VariableClasses
  /** whether an edge class is undirected, so its arrow can drop its head */
  undirected?: (ref: IrSchemaRef) => boolean
}) {
  const variables =
    outer ??
    (() => {
      const found = new Map<number, IrSchemaRef>()
      collectVariables(pattern, found)
      return found
    })()
  if ('allOf' in pattern) {
    return (
      <Lines label="all of">
        {pattern.allOf.map((p, i) => (
          <PatternWords
            key={i}
            pattern={p}
            origin={origin}
            variables={variables}
            undirected={undirected}
          />
        ))}
      </Lines>
    )
  }
  if ('anyOf' in pattern) {
    return (
      <Lines label="any of">
        {pattern.anyOf.map((p, i) => (
          <PatternWords
            key={i}
            pattern={p}
            origin={origin}
            variables={variables}
            undirected={undirected}
          />
        ))}
      </Lines>
    )
  }
  if ('exists' in pattern) {
    const names = pattern.exists.nodes
      .map((node) => {
        const cls = variableClass(node)
        return cls
          ? `${anInstance(policyLabel(cls, origin))}${'class' in node ? ' (exact class)' : ''}`
          : 'a Node'
      })
      .join(', ')
    return (
      <Lines label={`there is ${names} such that`}>
        <PatternWords
          pattern={pattern.exists.where}
          origin={origin}
          variables={variables}
          undirected={undirected}
        />
      </Lines>
    )
  }
  if ('sameNode' in pattern)
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <TermChip term={pattern.sameNode.left} variables={variables} origin={origin} />
        <span className="text-muted-foreground">is the same Node as</span>
        <TermChip term={pattern.sameNode.right} variables={variables} origin={origin} />
      </div>
    )
  if (!isEdgeStep(pattern)) return null
  const twoWay = undirected?.(pattern.class) === true
  const repeat = pattern.repeat
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <TermChip term={pattern.source} variables={variables} origin={origin} />
      <span className="inline-flex items-center gap-0.5 font-mono text-[11px] text-schema-edge">
        <Minus className="h-3 w-3" />
        {policyLabel(pattern.class, origin)}
        {repeat && (
          <span className="text-muted-foreground" title="hops along this edge class">
            ×{repeat.min}..{repeat.max}
          </span>
        )}
        {twoWay ? <Minus className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
      </span>
      <TermChip term={pattern.target} variables={variables} origin={origin} />
    </div>
  )
}

/** The whole rule: a pattern, or the policies it is composed of (each one a link). */
export function ExpressionWords({
  policy,
  index,
  onOpen,
  undirected,
}: {
  policy: Policy
  index: PolicyIndex
  onOpen: (key: string) => void
  undirected?: (ref: IrSchemaRef) => boolean
}) {
  const expression = policy.expression
  if ('match' in expression) {
    return <PatternWords pattern={expression.match} origin={index.origin} undirected={undirected} />
  }
  const refs = 'allOf' in expression ? expression.allOf : expression.anyOf
  return (
    <Lines label={'allOf' in expression ? 'all of these policies' : 'any of these policies'}>
      {refs.map((ref) => {
        const key = schemaRefKey(ref)
        const known = index.byKey.has(key)
        return (
          <button
            key={key}
            type="button"
            disabled={!known}
            onClick={() => onOpen(key)}
            className={cn(
              'w-fit rounded-md px-1.5 py-px text-left text-[12px] font-medium',
              known ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground line-through',
            )}
            title={known ? 'Open this policy' : 'Not declared by this domain'}
          >
            {policyLabel(ref, index.origin)}
          </button>
        )
      })}
    </Lines>
  )
}

/** What a callable's check binds the policy's object to. */
export function checkObjectWords(object: PolicyCheckObject): string {
  switch (object.kind) {
    case 'self':
      return 'self'
    case 'input':
      return `input.${object.field}`
    case 'ref':
      return `${object.ref.kind} ${object.ref.name}`
  }
}
