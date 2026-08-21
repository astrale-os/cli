import type {
  RememberedViewTarget,
  ViewTargetCandidate,
  ViewTargetResult,
} from '../../shared/types'

const NAMED_NAME = 'kernel.astrale.ai:interface.Named.property.name'
const DESCRIPTABLE_DESCRIPTION = 'kernel.astrale.ai:interface.Descriptable.property.description'
const STATUSED_STATUS = 'kernel.astrale.ai:interface.Statused.property.status'

export interface RawTargetRow {
  id?: unknown
  props?: Record<string, unknown>
}

export function reconcileRememberedTarget(
  remembered: RememberedViewTarget | null,
  items: ViewTargetCandidate[],
): Pick<ViewTargetResult, 'selected' | 'stale'> {
  if (!remembered) return { selected: null, stale: null }
  const selected = items.find((item) => item.id === remembered.id) ?? null
  return { selected, stale: selected ? null : remembered }
}

export function targetFromRow(
  row: RawTargetRow,
  className: string,
  classOrigin: string,
): ViewTargetCandidate | null {
  const id =
    typeof row.id === 'string' ? row.id : typeof row.props?.id === 'string' ? row.props.id : ''
  if (!id) return null
  const props = row.props ?? {}
  const firstName = stringProp(props, ['.property.firstName'])
  const lastName = stringProp(props, ['.property.lastName'])
  const label =
    asNonEmptyString(props[NAMED_NAME]) ??
    stringProp(props, ['.property.title', '.property.label', '.property.name', '.property.slug']) ??
    ([firstName, lastName].filter(Boolean).join(' ') || `${className} · ${id.slice(0, 8)}`)
  return {
    id,
    ref: `@${id}`,
    className,
    classOrigin,
    label,
    description:
      asNonEmptyString(props[DESCRIPTABLE_DESCRIPTION]) ??
      stringProp(props, ['.property.description', '.property.email']),
    status: asNonEmptyString(props[STATUSED_STATUS]) ?? stringProp(props, ['.property.status']),
  }
}

function stringProp(props: Record<string, unknown>, suffixes: string[]): string | undefined {
  for (const suffix of suffixes) {
    for (const [key, value] of Object.entries(props)) {
      if (!key.endsWith(suffix)) continue
      const text = asNonEmptyString(value)
      if (text) return text
    }
  }
  return undefined
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
