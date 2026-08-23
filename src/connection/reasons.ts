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
    return {
      origin,
      issue: details.issue,
      installedIssuer: details.installedIssuer,
      replacementIssuer: details.replacementIssuer,
    }
  }
  return origin === undefined ? {} : { origin }
}

export function schemaUpgradeHint(details: SchemaUpgradeDetails): string {
  const target = details.origin ?? '<origin>'
  const explanation =
    details.issue === 'issuer-changed'
      ? 'A replacement cannot change an installed Domain issuer.'
      : 'The replacement changes an immutable part of the installed Domain.'
  return (
    `${explanation} If this change is intentional, first run ` +
    `\`astrale domain uninstall ${target}\`, then install it again. ` +
    'The Kernel refuses uninstall while dependents or business data remain; uninstall never deletes business data.'
  )
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
