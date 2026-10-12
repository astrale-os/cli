import { ResponseError } from '@astrale-os/sdk/client'

/** The Kernel's AUTH_INVALID: it does not accept the presented credential (an unregistered account too). */
export const CREDENTIAL_REFUSED = 2002

export function credentialRefused(error: unknown): error is ResponseError {
  return error instanceof ResponseError && error.code === CREDENTIAL_REFUSED
}

export type FunctionInputIssue = Readonly<{
  code: string
  path?: string
  message: string
}>

export type QueryInputRepair =
  | Readonly<{ phase: 'decode' | 'input'; path: string }>
  | Readonly<{ phase: 'plan'; issue: string; path?: string }>
  | Readonly<{
      phase: 'limit'
      limit: string
      maximum: number
      actual: number
      path?: string
    }>

/** The public details of a Kernel upgrade refusal (CT10). */
export type SchemaUpgradeDetails =
  | {
      readonly origin?: string
      readonly issue?: undefined
    }
  | {
      readonly origin: string
      readonly issue: 'issuer-changed'
      readonly installedIssuer: string
      readonly replacementIssuer: string
      /** The issuers a consent named when it did not match the installed and served ones. */
      readonly consented?: { readonly from: string; readonly to: string }
    }
  | {
      readonly origin: string
      readonly issue: 'in-flight-limit'
      readonly inFlight: number
    }

const JSON_POINTER = /^(?:\/(?:[^~/]|~[01])*)*$/u
const MAXIMUM_FUNCTION_ISSUES = 32
const MAXIMUM_FUNCTION_ISSUE_MESSAGE_LENGTH = 512

export function reasonCode(reason: unknown): string | undefined {
  if (!record(reason) || typeof reason.code !== 'string') return undefined
  return stableCode(reason.code) ? reason.code : undefined
}

/** Admit only bounded caller-safe Function input issues established by the Kernel. */
export function functionInputIssues(reason: unknown): readonly FunctionInputIssue[] {
  if (!reasonWithCode(reason, 'FUNCTION_INPUT_INVALID')) return Object.freeze([])
  const issues = reason.details.issues
  if (!Array.isArray(issues)) return Object.freeze([])
  return Object.freeze(
    issues.slice(0, MAXIMUM_FUNCTION_ISSUES).flatMap((candidate): FunctionInputIssue[] => {
      if (
        !record(candidate) ||
        typeof candidate.code !== 'string' ||
        !stableCode(candidate.code) ||
        typeof candidate.message !== 'string' ||
        candidate.message.length === 0 ||
        candidate.message.length > MAXIMUM_FUNCTION_ISSUE_MESSAGE_LENGTH ||
        candidate.message.normalize('NFC') !== candidate.message ||
        containsControl(candidate.message) ||
        (candidate.path !== undefined && !coordinate(candidate.path))
      ) {
        return []
      }
      return [
        Object.freeze({
          code: candidate.code,
          ...(candidate.path === undefined ? {} : { path: candidate.path }),
          message: candidate.message,
        }),
      ]
    }),
  )
}

/** Admit only public Query-input repair variants; unknown details remain machine-only. */
export function queryInputRepair(reason: unknown): QueryInputRepair | undefined {
  if (!reasonWithCode(reason, 'QUERY_INPUT_INVALID')) return undefined
  const details = reason.details
  if (details.phase === 'decode' || details.phase === 'input') {
    if (!exact(details, ['phase', 'path']) || !coordinate(details.path)) return undefined
    return Object.freeze({ phase: details.phase, path: details.path })
  }
  if (details.phase === 'plan') {
    const fields = details.path === undefined ? ['phase', 'issue'] : ['phase', 'issue', 'path']
    if (
      !exact(details, fields) ||
      typeof details.issue !== 'string' ||
      !stableCode(details.issue) ||
      (details.path !== undefined && !coordinate(details.path))
    ) {
      return undefined
    }
    return Object.freeze({
      phase: 'plan',
      issue: details.issue,
      ...(details.path === undefined ? {} : { path: details.path }),
    })
  }
  if (details.phase !== 'limit') return undefined
  const fields =
    details.path === undefined
      ? ['phase', 'limit', 'maximum', 'actual']
      : ['phase', 'limit', 'maximum', 'actual', 'path']
  if (
    !exact(details, fields) ||
    typeof details.limit !== 'string' ||
    !Number.isSafeInteger(details.maximum) ||
    (details.maximum as number) < 0 ||
    !Number.isSafeInteger(details.actual) ||
    (details.actual as number) <= (details.maximum as number) ||
    (details.path !== undefined && !coordinate(details.path))
  ) {
    return undefined
  }
  return Object.freeze({
    phase: 'limit',
    limit: details.limit,
    maximum: details.maximum as number,
    actual: details.actual as number,
    ...(details.path === undefined ? {} : { path: details.path }),
  })
}

/** Decode bounded recovery guidance while preserving the admitted reason itself elsewhere. */
export function schemaUpgradeDetails(reason: unknown): SchemaUpgradeDetails | undefined {
  if (!record(reason) || reason.code !== 'SCHEMA_UPGRADE_INCOMPATIBLE') return undefined
  const details = record(reason.details) ? reason.details : {}
  const origin = typeof details.origin === 'string' ? details.origin : undefined
  if (
    details.issue === 'issuer-changed' &&
    origin !== undefined &&
    typeof details.installedIssuer === 'string' &&
    typeof details.replacementIssuer === 'string'
  ) {
    const consented = record(details.consented) ? details.consented : undefined
    return {
      origin,
      issue: details.issue,
      installedIssuer: details.installedIssuer,
      replacementIssuer: details.replacementIssuer,
      ...(typeof consented?.from === 'string' && typeof consented.to === 'string'
        ? { consented: { from: consented.from, to: consented.to } }
        : {}),
    }
  }
  if (
    details.issue === 'in-flight-limit' &&
    origin !== undefined &&
    Number.isSafeInteger(details.inFlight)
  ) {
    return { origin, issue: details.issue, inFlight: details.inFlight as number }
  }
  return origin === undefined ? {} : { origin }
}

export function schemaUpgradeHint(details: SchemaUpgradeDetails): string {
  const target = details.origin ?? '<origin>'
  if (details.issue === 'issuer-changed') {
    if (details.consented !== undefined) {
      return (
        `The consent named ${details.consented.from} -> ${details.consented.to}, but ${target} ` +
        `is installed under ${details.installedIssuer} and the URL serves ` +
        `${details.replacementIssuer}: the installation changed after it was read. Run the ` +
        'install again to plan it from the current installation.'
      )
    }
    return (
      `Installing it changes the issuer of ${target}. Consent by installing its deployment URL ` +
      `with --allow-issuer-change=${target} (--allow-issuer-change covers a new deployment of ` +
      'the same line), or confirm it at a terminal. A Kernel that takes no issuer consent needs ' +
      `\`astrale domain uninstall ${target}\` first, then the install again; safe uninstall ` +
      'refuses surviving dependents or owned data.'
    )
  }
  if (details.issue === 'in-flight-limit') {
    return (
      `${target} already keeps ${details.inFlight} replaced issuers in flight. Wait until their ` +
      'durable runs end, or install again with --revoke-previous to cut the replaced issuer at ' +
      'the activation instead of draining it.'
    )
  }
  return (
    'The replacement changes an immutable part of the installed Domain. If this change is ' +
    `intentional, first run \`astrale domain uninstall ${target}\`, then install it again. ` +
    `Safe uninstall refuses surviving dependents or owned data. Use ` +
    `\`astrale domain uninstall ${target} --destructive\` only if that owned data should be deleted; ` +
    'surviving dependents and foreign references still block it.'
  )
}

/** One data migration a schema change requires, as `DATA_MIGRATION_REQUIRED` names it. */
export interface MigrationRequirement {
  /** What must happen to the data: `remove-facts`, `populate-required`, `rewrite-values`, … */
  readonly operation: string
  /** Why: `destructive-change`, `budget-exceeded`, `invalid-existing`, `foreign-reference`, … */
  readonly reason: string
  /** The Class, Property or Domain it concerns, as a reader names it. */
  readonly subject: string
  readonly work: {
    readonly observedFacts?: number
    readonly maximumFacts?: number
    readonly observedBytes?: number
    readonly maximumBytes?: number
  }
}

const MAXIMUM_REQUIREMENTS = 32

/**
 * The requirements of a `DATA_MIGRATION_REQUIRED` failure's details, bounded; a requirement whose
 * shape is not the published one is left out, so only what the Kernel stated is shown.
 */
export function migrationRequirements(details: unknown): readonly MigrationRequirement[] {
  if (!record(details) || !Array.isArray(details.requirements)) return Object.freeze([])
  return Object.freeze(
    details.requirements.slice(0, MAXIMUM_REQUIREMENTS).flatMap((item): MigrationRequirement[] => {
      if (
        !record(item) ||
        typeof item.operation !== 'string' ||
        typeof item.reason !== 'string' ||
        !record(item.work)
      ) {
        return []
      }
      const subject = migrationSubject(item.subject)
      if (subject === undefined) return []
      const measured = item.work
      const work = Object.fromEntries(
        ['observedFacts', 'maximumFacts', 'observedBytes', 'maximumBytes'].flatMap((key) =>
          Number.isSafeInteger(measured[key]) ? [[key, measured[key] as number]] : [],
        ),
      )
      return [Object.freeze({ operation: item.operation, reason: item.reason, subject, work })]
    }),
  )
}

/** A Class as `Item (crm.acme.dev)`, a Property by its key, a Domain by its origin. */
function migrationSubject(subject: unknown): string | undefined {
  if (!record(subject)) return undefined
  if (subject.kind === 'domain' && typeof subject.origin === 'string') return subject.origin
  if (subject.kind === 'property' && typeof subject.key === 'string') return subject.key
  if (subject.kind !== 'definition' || !record(subject.ref)) return undefined
  return definitionLabel(subject.ref)
}

/** One rule of the target schema the stored data does not hold, from a migration report. */
export interface MigrationRule {
  /** The Property it checks as `Class.property (origin)`, else its Class as `Class (origin)`. */
  readonly rule: string
  /** What it checks: `required`, `value`, `declared`, `endpoints`, … */
  readonly family: string
  readonly verdict: 'refuted' | 'undecided'
  /** Why an undecided rule has no verdict: `budget`, `timeout` or `cancelled`. */
  readonly undecided?: string
  readonly count?: {
    readonly unit: 'facts' | 'values'
    readonly value: number
    readonly bound: 'exact' | 'atLeast'
  }
  /** The first refuting facts by id, or rejected values as JSON. */
  readonly offenders: readonly string[]
  /** Whether more refute it than `count` and `offenders` show. */
  readonly truncated: boolean
}

/** The rules a migration report lists, and whether it lists every rule that does not hold. */
export interface MigrationRules {
  readonly rules: readonly MigrationRule[]
  readonly truncated: boolean
}

const MAXIMUM_OBSERVED_LENGTH = 60

/**
 * The rules the `report` of a `DATA_MIGRATION_REQUIRED` failure's details lists, bounded; a rule
 * whose shape is not the published one is left out.
 */
export function migrationRules(details: unknown): MigrationRules {
  const report = record(details) && record(details.report) ? details.report : undefined
  const listed = Array.isArray(report?.rules) ? report.rules : []
  const rules = listed.slice(0, MAXIMUM_REQUIREMENTS).flatMap((item): MigrationRule[] => {
    if (
      !record(item) ||
      typeof item.family !== 'string' ||
      (item.verdict !== 'refuted' && item.verdict !== 'undecided')
    ) {
      return []
    }
    const owner = definitionLabel(item.class)
    if (owner === undefined) return []
    const property = typeof item.property === 'string' ? propertyName(item.property) : undefined
    const name = record(item.class) && typeof item.class.name === 'string' ? item.class.name : owner
    const rule = property === undefined ? owner : owner.replace(name, `${name}.${property}`)
    const count = record(item.count) ? item.count : undefined
    const offenders = Array.isArray(item.offenders) ? item.offenders : []
    return [
      Object.freeze({
        rule,
        family: item.family,
        verdict: item.verdict,
        ...(typeof item.undecided === 'string' ? { undecided: item.undecided } : {}),
        ...(count !== undefined &&
        (count.unit === 'facts' || count.unit === 'values') &&
        Number.isSafeInteger(count.value) &&
        (count.bound === 'exact' || count.bound === 'atLeast')
          ? {
              count: {
                unit: count.unit as 'facts' | 'values',
                value: count.value as number,
                bound: count.bound as 'exact' | 'atLeast',
              },
            }
          : {}),
        offenders: Object.freeze(offenders.flatMap(offenderLabel)),
        truncated: item.truncated === true,
      }),
    ]
  })
  return Object.freeze({ rules: Object.freeze(rules), truncated: report?.truncated === true })
}

/** `category` from `<origin>:class.Item.property.category`; any other key as it is. */
function propertyName(key: string): string {
  const marker = '.property.'
  const at = key.lastIndexOf(marker)
  return at < 0 ? key : key.slice(at + marker.length)
}

/** A refuting fact by its id, or a rejected value as JSON, shortened. */
function offenderLabel(offender: unknown): string[] {
  if (!record(offender)) return []
  if (record(offender.fact) && typeof offender.fact.id === 'string') return [offender.fact.id]
  if (offender.observed === undefined) return []
  const observed = JSON.stringify(offender.observed)
  return [
    observed.length > MAXIMUM_OBSERVED_LENGTH
      ? `${observed.slice(0, MAXIMUM_OBSERVED_LENGTH - 1)}…`
      : observed,
  ]
}

/** A Class or other definition reference as `<name> (<origin>)`. */
export function definitionLabel(ref: unknown): string | undefined {
  if (!record(ref) || typeof ref.name !== 'string') return undefined
  return typeof ref.origin === 'string' ? `${ref.name} (${ref.origin})` : ref.name
}

/**
 * A refusal of an operation id another request already used: `SCHEMA_OPERATION_CONFLICT` for an
 * install or uninstall (`IDEMPOTENCY_KEY_CONFLICT` on 1.0.0-beta.5 and beta.6 Kernels).
 */
export function operationConflict(reason: unknown): boolean {
  const code = reasonCode(reason)
  return code === 'SCHEMA_OPERATION_CONFLICT' || code === 'IDEMPOTENCY_KEY_CONFLICT'
}

/**
 * What an operation conflict names of the request the operation already belongs to: its Execution
 * and, for an install, the mode it was requested in, when the Kernel names them.
 */
export function conflictDetails(reason: unknown): {
  readonly execution?: string
  readonly mode?: string
} {
  if (!operationConflict(reason) || !record(reason) || !record(reason.details)) return {}
  const { execution, mode } = reason.details
  return {
    ...(typeof execution === 'string' && execution.length > 0 ? { execution } : {}),
    ...(typeof mode === 'string' && mode.length > 0 ? { mode } : {}),
  }
}

export function schemaDataRemovalHint(reason: unknown): string | undefined {
  if (!reasonWithCode(reason, 'DATA_MIGRATION_REQUIRED')) return undefined
  const requirements = reason.details.requirements
  if (
    !Array.isArray(requirements) ||
    requirements.length === 0 ||
    !requirements.every(
      (item) =>
        record(item) && item.operation === 'remove-facts' && item.reason === 'destructive-change',
    )
  ) {
    return undefined
  }
  return 'Delete this data explicitly, then retry. No data was deleted.'
}

function reasonWithCode(
  input: unknown,
  code: string,
): input is Readonly<{ code: string; details: Readonly<Record<string, unknown>> }> {
  return (
    record(input) &&
    exact(input, ['code', 'details']) &&
    input.code === code &&
    record(input.details)
  )
}

function coordinate(input: unknown): input is string {
  return (
    typeof input === 'string' &&
    input.length <= 1_024 &&
    input.normalize('NFC') === input &&
    JSON_POINTER.test(input)
  )
}

function stableCode(input: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,127}$/u.test(input) && input.normalize('NFC') === input
}

function containsControl(input: string): boolean {
  for (const character of input) {
    const point = character.codePointAt(0)!
    if (point <= 0x1f || point === 0x7f) return true
  }
  return false
}

function record(input: unknown): input is Readonly<Record<string, unknown>> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
}

function exact(input: Readonly<Record<string, unknown>>, fields: readonly string[]): boolean {
  const actual = Object.keys(input)
  return actual.length === fields.length && actual.every((field) => fields.includes(field))
}
