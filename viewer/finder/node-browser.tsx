import { Button, buttonVariants } from '@astrale-os/ui/button'
import { cn } from '@astrale-os/ui/class-name'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@astrale-os/ui/dropdown-menu'
import {
  Finder,
  FinderAddRule,
  FinderCancel,
  FinderCell,
  FinderChip,
  FinderChipRemove,
  FinderClasses,
  FinderClearRules,
  FinderColumnHeader,
  FinderConfirm,
  FinderDomains,
  FinderHeader,
  FinderIcon,
  FinderNodeRow,
  FinderOption,
  FinderPath,
  FinderPreview,
  FinderRows,
  FinderRuleOperator,
  FinderRuleProperty,
  FinderRuleRemove,
  FinderRuleValue,
  FinderRules,
  FinderTable,
  FinderTray,
  finderCellText,
  formatFinderCount,
  formatFinderValue,
  initialsOf,
  useFinder,
  type FinderChoice,
  type FinderClass,
  type FinderImage,
  type FinderNodeDetail,
  type FinderOperator,
  type FinderPathSegment,
  type FinderPlace,
  type FinderRow,
  type FinderRuleValueLabels,
  type FinderSource,
  type FinderTableColumn,
} from '@astrale-os/ui/finder'
import { Skeleton } from '@astrale-os/ui/skeleton'
import { createContext, useContext, useId } from 'react'

export interface NodeBrowserProps {
  /** What the Finder reads: the host's graph, read as the user. */
  source: FinderSource
  /** Class keys the request accepts; each admits every Class that extends it. */
  accepts?: readonly string[]
  /** How many Nodes the user may choose. Default 1. */
  maximum?: number
  /** Where to open, usually the place `onPlaceChange` last reported. */
  defaultPlace?: FinderPlace
  onPlaceChange?(place: FinderPlace): void
  /**
   * Take the chosen Nodes. While a returned promise runs, Select waits; when it rejects, the
   * message of the `Error` shows above the buttons and the choices stay.
   */
  onConfirm(choices: readonly FinderChoice[]): void | Promise<void>
  onCancel(): void
  /** Picks each icon's dark image; absent, the color-scheme preference decides. */
  theme?: 'light' | 'dark'
  /** The heading, in place of the one the request implies: Select Issue or Project. */
  title?: React.ReactNode
  /** A line under the heading: who asks, or why. */
  description?: React.ReactNode
  /** The id of the title, for a dialog that names itself by it. */
  titleId?: string
  /** The id of the description, for a dialog that describes itself by it. */
  descriptionId?: string
  /** The words it shows, each in place of its English default. */
  messages?: Partial<NodeBrowserMessages>
  className?: string
  style?: React.CSSProperties
}

/** The words the browser shows; a host in another language gives its own. */
export interface NodeBrowserMessages {
  readonly selectNode: string
  readonly selectNodes: string
  /** Opens the title of a request that names its Classes: Select Issue or Project. */
  readonly selectKind: string
  readonly or: string
  /** The header count, already formatted: `1,000+`; `one` when it is exactly one. */
  readonly count: (count: string, one: boolean) => string
  readonly domains: string
  readonly classes: string
  readonly nodes: string
  readonly allAccepted: string
  readonly nothingReadable: string
  readonly domainsFailed: string
  readonly classesFailed: string
  readonly retry: string
  readonly filter: string
  readonly addRule: string
  readonly columns: string
  readonly filters: string
  readonly clear: string
  readonly property: string
  readonly operator: string
  readonly operators: Readonly<Record<FinderOperator, string>>
  /** A rule's value fields, and Yes and No wherever a value shows. */
  readonly values: FinderRuleValueLabels
  readonly removeRule: string
  /** The name column, when the Classes declare no name property. */
  readonly name: string
  readonly class: string
  readonly chooseClass: string
  readonly nodesFailed: string
  readonly moreFailed: string
  readonly noName: string
  readonly noNodes: string
  readonly noMatch: string
  readonly clearFilters: string
  readonly preview: string
  readonly nodeFailed: string
  readonly location: string
  readonly filterCount: (count: number) => string
  readonly chosen: string
  readonly remove: (name: string) => string
  /** Shown when Select fails with no message of its own. */
  readonly confirmFailed: string
  readonly tally: (count: number, maximum: number) => string
  readonly cancel: string
  readonly confirm: string
}

export const NODE_BROWSER_MESSAGES: NodeBrowserMessages = {
  selectNode: 'Select a Node',
  selectNodes: 'Select Nodes',
  selectKind: 'Select',
  or: 'or',
  count: (count, one) => `${count} ${one ? 'Node' : 'Nodes'}`,
  domains: 'Domains',
  classes: 'Classes',
  nodes: 'Nodes',
  allAccepted: 'All accepted',
  nothingReadable: 'Nothing here you can read',
  domainsFailed: 'Couldn’t load the Domains',
  classesFailed: 'Couldn’t load the Classes',
  retry: 'Retry',
  filter: 'Filter',
  addRule: 'Add rule',
  columns: 'Columns',
  filters: 'Filters',
  clear: 'Clear',
  property: 'Property',
  operator: 'Operator',
  operators: {
    is: 'is',
    isOneOf: 'is one of',
    startsWith: 'starts with',
    between: 'between',
    isSet: 'is set',
  },
  values: {
    yes: 'Yes',
    no: 'No',
    value: 'Value',
    from: 'From',
    to: 'To',
    choose: 'Choose…',
    values: 'Values, comma-separated',
    custom: 'Custom range',
    last24Hours: 'Last 24 hours',
    last7Days: 'Last 7 days',
    last30Days: 'Last 30 days',
  },
  removeRule: 'Remove rule',
  name: 'Name',
  class: 'Class',
  chooseClass: 'Choose a Class to list its Nodes',
  nodesFailed: 'Couldn’t load the Nodes',
  moreFailed: 'Couldn’t load more Nodes',
  noName: 'No name',
  noNodes: 'No Nodes you can read',
  noMatch: 'No Nodes you can read match these filters',
  clearFilters: 'Clear filters',
  preview: 'Preview',
  nodeFailed: 'Couldn’t load this Node',
  location: 'Location',
  filterCount: (count) => (count === 1 ? '1 filter' : `${count} filters`),
  chosen: 'Chosen Nodes',
  remove: (name) => `Remove ${name}`,
  confirmFailed: 'Couldn’t select these Nodes',
  tally: (count, maximum) => `${count} of ${maximum}`,
  cancel: 'Cancel',
  confirm: 'Select',
}

const Messages = createContext(NODE_BROWSER_MESSAGES)

/** The Finder as a panel: Domains › Classes › Nodes, with filters, preview, path and tray. */
export function NodeBrowser({
  source,
  accepts,
  maximum,
  defaultPlace,
  onPlaceChange,
  onConfirm,
  onCancel,
  theme,
  title,
  description,
  titleId,
  descriptionId,
  messages,
  className,
  style,
}: NodeBrowserProps) {
  const fallbackTitleId = useId()
  const fallbackDescriptionId = useId()
  return (
    <Messages.Provider
      value={messages ? { ...NODE_BROWSER_MESSAGES, ...messages } : NODE_BROWSER_MESSAGES}
    >
      <Finder
        data-slot="block-finder-node-browser"
        source={source}
        {...(accepts ? { accepts } : {})}
        {...(maximum === undefined ? {} : { maximum })}
        {...(defaultPlace ? { defaultPlace } : {})}
        {...(onPlaceChange ? { onPlaceChange } : {})}
        {...(theme ? { theme } : {})}
        onConfirm={onConfirm}
        onCancel={onCancel}
        className={cn(
          'flex h-full min-h-0 min-w-0 flex-col bg-popover text-sm text-popover-foreground',
          className,
        )}
        style={style}
      >
        <BrowserHeader
          title={title}
          description={description}
          titleId={titleId ?? fallbackTitleId}
          descriptionId={descriptionId ?? fallbackDescriptionId}
        />
        <div data-slot="block-finder-body" className="relative flex min-h-0 flex-1 border-t">
          <DomainsColumn />
          <ClassesColumn />
          <div data-slot="block-finder-main" className="flex min-w-0 flex-1 flex-col">
            <Toolbar />
            <RulesBar />
            <NodesTable />
          </div>
          <PreviewPanel />
        </div>
        <PathBar />
        <Footer />
      </Finder>
    </Messages.Provider>
  )
}

// ── Look ──────────────────────────────────────────────────────────────────────────────────────

const iconSmall =
  'grid size-4 shrink-0 place-items-center overflow-hidden rounded-[3px] text-muted-foreground group-data-selected/option:text-current group-data-active/row:text-current [&_img]:size-full [&_img]:object-contain'
const iconDomain =
  'grid size-5 shrink-0 place-items-center overflow-hidden rounded-[5px] [&_img]:size-full [&_img]:object-contain data-fallback:bg-muted data-fallback:ring-1 data-fallback:ring-border data-fallback:ring-inset data-fallback:text-[0.5625rem] data-fallback:font-semibold data-fallback:text-muted-foreground'
const column =
  'group/list flex w-40 shrink-0 flex-col gap-px overflow-y-auto border-r p-1.5 outline-none focus-visible:bg-accent/30 lg:w-52'
const option =
  'group/option flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1 select-none hover:bg-accent/50 data-selected:bg-accent data-selected:text-accent-foreground group-focus-visible/list:data-active:ring-1 group-focus-visible/list:data-active:ring-ring/60 group-focus-visible/list:data-active:ring-inset'
const field =
  'h-7 min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30'
const iconButton =
  'grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50'

function ClassGlyph() {
  return (
    <svg
      data-slot="block-finder-class-glyph"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="size-full"
      aria-hidden="true"
    >
      <rect
        data-slot="block-finder-class-glyph-frame"
        x="2.75"
        y="2.75"
        width="10.5"
        height="10.5"
        rx="2.5"
      />
      <circle data-slot="block-finder-class-glyph-core" cx="8" cy="8" r="1.75" />
    </svg>
  )
}

function Glyph({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      data-slot="block-finder-glyph"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-3.5 shrink-0', className)}
      aria-hidden="true"
    >
      <path data-slot="block-finder-glyph-path" d={path} />
    </svg>
  )
}

const CLOSE = 'M4.5 4.5l7 7M11.5 4.5l-7 7'
const CHEVRON = 'M6 3.5 10.5 8 6 12.5'
const CHECK = 'M3.5 8.5 6.5 11.5 12.5 4.5'
const FILTER = 'M2.5 4h11M4.5 8h7M6.5 12h3'
const ARROW_UP = 'M8 12.5v-9M4.5 7 8 3.5 11.5 7'
const ARROW_DOWN = 'M8 3.5v9M4.5 9 8 12.5 11.5 9'

function ClassIcon({ icon, className }: { icon: FinderImage | undefined; className?: string }) {
  return <FinderIcon icon={icon} fallback={<ClassGlyph />} className={cn(iconSmall, className)} />
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return Array.from({ length: rows }, (_, index) => (
    <div key={index} data-slot="block-finder-skeleton" className="flex h-8 items-center gap-2 px-2">
      <Skeleton className="size-4 rounded-[3px]" />
      <Skeleton className="h-3 flex-1" style={{ maxWidth: `${80 - index * 9}%` }} />
    </div>
  ))
}

function Failure({ retry, children }: { retry: () => void; children: React.ReactNode }) {
  const m = useContext(Messages)
  return (
    <div
      data-slot="block-finder-failure"
      role="alert"
      className="flex flex-col items-start gap-2 px-2 py-3 text-xs text-muted-foreground"
    >
      {children}
      <Button size="xs" variant="outline" onClick={retry}>
        {m.retry}
      </Button>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p data-slot="block-finder-note" className="px-2 py-3 text-xs text-muted-foreground">
      {children}
    </p>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────────────────────

function BrowserHeader({
  title,
  description,
  titleId,
  descriptionId,
}: {
  title: React.ReactNode
  description: React.ReactNode
  titleId: string
  descriptionId: string
}) {
  const finder = useFinder()
  const m = useContext(Messages)
  return (
    <div data-slot="block-finder-header" className="flex min-h-12 items-center gap-3 px-4 py-2.5">
      <div data-slot="block-finder-heading" className="grid min-w-0 gap-0.5">
        <h2
          id={titleId}
          data-slot="block-finder-title"
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 font-heading text-base font-medium"
        >
          {title ??
            (finder.accepts ? (
              <>
                {`${m.selectKind} `}
                {finder.acceptedClasses.map((kind, index) => (
                  <span
                    key={kind.key}
                    data-slot="block-finder-kind"
                    className="flex items-center gap-1.5"
                  >
                    {index > 0 ? (
                      <span
                        data-slot="block-finder-kind-separator"
                        className="font-normal text-muted-foreground"
                      >
                        {` ${m.or} `}
                      </span>
                    ) : null}
                    <ClassIcon icon={kind.icon} />
                    {kind.name}{' '}
                  </span>
                ))}
              </>
            ) : finder.maximum === 1 ? (
              m.selectNode
            ) : (
              m.selectNodes
            ))}
        </h2>
        {description ? (
          <p
            id={descriptionId}
            data-slot="block-finder-description"
            className="truncate text-xs text-muted-foreground"
          >
            {description}
          </p>
        ) : null}
      </div>
      <NodeCount />
    </div>
  )
}

function NodeCount() {
  const { count } = useFinder()
  const m = useContext(Messages)
  if (count.status === 'idle' || count.status === 'error') return null
  if (!count.value) return <Skeleton className="ml-auto h-3.5 w-16" />
  const one = count.value.value === 1 && !count.value.more
  return (
    <span
      data-slot="block-finder-count"
      aria-live="polite"
      className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
    >
      {m.count(formatFinderCount(count.value), one)}
    </span>
  )
}

// ── Columns ───────────────────────────────────────────────────────────────────────────────────

function DomainsColumn() {
  const finder = useFinder()
  const m = useContext(Messages)
  const accepted = finder.acceptedClasses[0]
  return (
    <FinderDomains
      aria-label={m.domains}
      className={column}
      loading={<ListSkeleton />}
      empty={<Note>{m.nothingReadable}</Note>}
      error={(retry) => <Failure retry={retry}>{m.domainsFailed}</Failure>}
    >
      {(entry) => (
        <FinderOption
          className={option}
          title={entry.kind === 'domain' ? entry.domain.origin : undefined}
        >
          {entry.kind === 'accepted' ? (
            <>
              <FinderIcon icon={accepted?.icon} fallback={<ClassGlyph />} className={iconDomain} />
              <span data-slot="block-finder-option-name" className="min-w-0 flex-1 truncate">
                {m.allAccepted}
              </span>
            </>
          ) : (
            <>
              <FinderIcon
                icon={entry.domain.icon}
                fallback={initialsOf(entry.domain.name)}
                className={iconDomain}
              />
              <span data-slot="block-finder-option-name" className="min-w-0 flex-1 truncate">
                {entry.domain.name}
              </span>
            </>
          )}
          <Glyph
            path={CHEVRON}
            className="size-3 text-muted-foreground group-data-selected/option:text-current"
          />
        </FinderOption>
      )}
    </FinderDomains>
  )
}

function ClassesColumn() {
  const m = useContext(Messages)
  return (
    <FinderClasses
      aria-label={m.classes}
      className={column}
      loading={<ListSkeleton rows={4} />}
      empty={<Note>{m.nothingReadable}</Note>}
      error={(retry) => <Failure retry={retry}>{m.classesFailed}</Failure>}
    >
      {(item: FinderClass) => (
        <FinderOption className={option} title={item.description}>
          <ClassIcon icon={item.icon} />
          <span data-slot="block-finder-option-text" className="grid min-w-0 flex-1">
            <span data-slot="block-finder-option-name" className="truncate">
              {item.name}
            </span>
            {item.description ? (
              <span
                data-slot="block-finder-option-description"
                className="truncate text-xs text-muted-foreground group-data-selected/option:text-current"
              >
                {item.description}
              </span>
            ) : null}
          </span>
        </FinderOption>
      )}
    </FinderClasses>
  )
}

// ── Toolbar and filters ───────────────────────────────────────────────────────────────────────

function Toolbar() {
  const finder = useFinder()
  const m = useContext(Messages)
  if (finder.table.status === 'idle') return null
  return (
    <div
      data-slot="block-finder-toolbar"
      className="flex h-9 shrink-0 items-center gap-1 border-b px-2"
    >
      <FinderAddRule
        className={buttonVariants({ variant: 'ghost', size: 'xs' })}
        title={`${m.filter} (⌘F)`}
      >
        <Glyph path={FILTER} className="size-3" />
        {finder.filtersOpen ? m.addRule : m.filter}
      </FinderAddRule>
      <ColumnsMenu />
    </div>
  )
}

function ColumnsMenu() {
  const finder = useFinder()
  const m = useContext(Messages)
  const columns = finder.table.hideableColumns
  if (columns.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="ml-auto" />}>
        {m.columns}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {columns.map((item) => (
          <DropdownMenuCheckboxItem
            key={item.key}
            checked={item.shown}
            onCheckedChange={(checked) => finder.setColumnShown(item.key, checked)}
          >
            {item.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RulesBar() {
  const finder = useFinder()
  const m = useContext(Messages)
  if (!finder.filtersOpen) return null
  return (
    <div
      data-slot="block-finder-rules-bar"
      className="flex shrink-0 items-start gap-2 border-b bg-muted/30 px-2 py-2"
    >
      <FinderRules aria-label={m.filters} className="flex min-w-0 flex-1 flex-col gap-1.5">
        {(rule) => (
          <div data-slot="block-finder-rule" className="flex flex-wrap items-center gap-1.5">
            <FinderRuleProperty rule={rule} aria-label={m.property} className={field} />
            <FinderRuleOperator
              rule={rule}
              labels={m.operators}
              aria-label={m.operator}
              className={field}
            />
            <FinderRuleValue
              rule={rule}
              labels={m.values}
              className="flex flex-wrap items-center gap-1.5"
              fieldClassName={cn(field, 'w-36')}
              choiceClassName="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
            />
            <FinderRuleRemove rule={rule} aria-label={m.removeRule} className={iconButton}>
              <Glyph path={CLOSE} className="size-3" />
            </FinderRuleRemove>
          </div>
        )}
      </FinderRules>
      <FinderClearRules className={buttonVariants({ variant: 'ghost', size: 'xs' })}>
        {m.clear}
      </FinderClearRules>
    </div>
  )
}

// ── Nodes ─────────────────────────────────────────────────────────────────────────────────────

/** Each column's narrowest width in rem, and its share of what is left. */
function track(item: FinderTableColumn): { minimum: number; share: number } {
  if (item.kind === 'name') return { minimum: 12, share: 2 }
  switch (item.property?.kind) {
    case 'instant':
      return { minimum: 7.5, share: 1 }
    case 'number':
    case 'boolean':
      return { minimum: 5, share: 0.6 }
    default:
      return { minimum: 7, share: 1 }
  }
}

/** The table's own columns speak the host's language; a property column keeps its schema label. */
function columnLabel(item: FinderTableColumn, m: NodeBrowserMessages): string {
  if (item.kind === 'class') return m.class
  if (item.kind === 'name' && !item.property) return m.name
  return item.label
}

function NodesTable() {
  const finder = useFinder()
  const m = useContext(Messages)
  const columns = finder.table.columns
  const tracks = columns.map(track)
  const layout = {
    '--finder-columns': tracks
      .map((item) => `minmax(${item.minimum}rem, ${item.share}fr)`)
      .join(' '),
    '--finder-min-width': `${tracks.reduce((total, item) => total + item.minimum, 0)}rem`,
  } as React.CSSProperties
  return (
    <FinderTable
      aria-label={m.nodes}
      style={layout}
      className="group/table relative min-h-0 flex-1 overflow-auto outline-none data-stale:[&_[data-slot=finder-row]]:opacity-60"
    >
      {finder.table.status === 'idle' ? null : (
        <FinderHeader className="sticky top-0 z-1 grid min-w-(--finder-min-width) grid-cols-(--finder-columns) border-b bg-popover text-xs text-muted-foreground">
          {(item) => (
            <FinderColumnHeader
              column={item}
              className={cn(
                'flex h-8 min-w-0 items-center px-3 font-medium [&>button]:flex [&>button]:min-w-0 [&>button]:items-center [&>button]:gap-1 [&>button]:rounded [&>button]:outline-none [&>button]:hover:text-foreground [&>button]:focus-visible:ring-2 [&>button]:focus-visible:ring-ring/50',
                item.property?.kind === 'number' && 'justify-end',
              )}
            >
              <span data-slot="block-finder-column-label" className="truncate">
                {columnLabel(item, m)}
              </span>
              <SortMark column={item} />
            </FinderColumnHeader>
          )}
        </FinderHeader>
      )}
      <FinderRows
        idle={<Note>{m.chooseClass}</Note>}
        loading={<TableSkeleton />}
        empty={<NoNodes />}
        error={(retry) => <Failure retry={retry}>{m.nodesFailed}</Failure>}
        more={<TableSkeleton rows={2} />}
        moreError={(retry) => <Failure retry={retry}>{m.moreFailed}</Failure>}
        className="pb-1"
      >
        {(row) => <NodeRow row={row} />}
      </FinderRows>
    </FinderTable>
  )
}

function SortMark({ column: item }: { column: FinderTableColumn }) {
  const { table } = useFinder()
  const order = table.order
  if (!item.property || order?.property !== item.property.key) return null
  return (
    <Glyph
      path={order.direction === 'asc' ? ARROW_UP : ARROW_DOWN}
      className="size-3 text-foreground"
    />
  )
}

function NodeRow({ row }: { row: FinderRow }) {
  const { table } = useFinder()
  const m = useContext(Messages)
  return (
    <FinderNodeRow
      row={row}
      className="group/row grid min-w-(--finder-min-width) cursor-default grid-cols-(--finder-columns) border-b border-border/50 select-none hover:bg-accent/50 data-active:bg-accent data-active:text-accent-foreground data-chosen:bg-primary/8 data-chosen:data-active:bg-primary/12 data-chosen:data-active:text-foreground data-disabled:cursor-not-allowed data-disabled:text-muted-foreground data-disabled:data-active:text-accent-foreground group-focus-visible/table:data-active:ring-1 group-focus-visible/table:data-active:ring-ring/60 group-focus-visible/table:data-active:ring-inset"
    >
      {table.columns.map((item) =>
        item.kind === 'name' ? (
          <FinderCell
            key={item.key}
            row={row}
            column={item}
            className="flex h-8 min-w-0 items-center gap-2 px-3"
          >
            <ClassIcon icon={row.nodeClass?.icon} />
            <span
              data-slot="block-finder-name"
              className={cn(
                'min-w-0 flex-1 truncate',
                row.unnamed && 'text-muted-foreground group-data-active/row:text-current',
              )}
            >
              {row.node.name ?? m.noName}
            </span>
            {row.chosen ? <Glyph path={CHECK} className="text-primary" /> : null}
          </FinderCell>
        ) : (
          <FinderCell
            key={item.key}
            row={row}
            column={item}
            className={cn(
              'flex h-8 min-w-0 items-center px-3',
              item.property?.kind === 'number' && 'justify-end tabular-nums',
            )}
          >
            <span data-slot="block-finder-value" className="truncate">
              {item.property?.kind === 'instant'
                ? day(row.node.values[item.property.key])
                : finderCellText(row, item, m.values)}
            </span>
          </FinderCell>
        ),
      )}
    </FinderNodeRow>
  )
}

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** An instant in a cell shows its day; the cell's title and the preview carry the time. */
function day(value: unknown): string {
  if (typeof value !== 'string') return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dayFormat.format(date)
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return Array.from({ length: rows }, (_, index) => (
    <div
      key={index}
      data-slot="block-finder-skeleton"
      className="flex h-8 items-center gap-2 border-b border-border/50 px-3"
    >
      <Skeleton className="size-4 rounded-[3px]" />
      <Skeleton className="h-3" style={{ width: `${36 - (index % 4) * 6}%` }} />
    </div>
  ))
}

function NoNodes() {
  const finder = useFinder()
  const m = useContext(Messages)
  if (finder.appliedRules.length === 0) return <Note>{m.noNodes}</Note>
  return (
    <div
      data-slot="block-finder-no-match"
      className="flex flex-col items-start gap-2 px-3 py-3 text-xs text-muted-foreground"
    >
      {m.noMatch}
      <FinderClearRules className={buttonVariants({ variant: 'outline', size: 'xs' })}>
        {m.clearFilters}
      </FinderClearRules>
    </div>
  )
}

// ── Preview ───────────────────────────────────────────────────────────────────────────────────

function PreviewPanel() {
  const m = useContext(Messages)
  return (
    <FinderPreview
      aria-label={m.preview}
      className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-popover p-4 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-2 max-lg:shadow-lg data-[status=loading]:[&_[data-slot=block-finder-preview-detail]]:opacity-60"
    >
      {(preview) =>
        preview.status === 'error' ? (
          <Failure retry={preview.retry}>{m.nodeFailed}</Failure>
        ) : preview.detail ? (
          <PreviewDetail detail={preview.detail} />
        ) : (
          <ListSkeleton rows={4} />
        )
      }
    </FinderPreview>
  )
}

function PreviewDetail({ detail }: { detail: FinderNodeDetail }) {
  const finder = useFinder()
  const m = useContext(Messages)
  const nodeClass = finder.classOf(detail.class)
  const properties = detail.properties.filter(
    (property) =>
      property.key !== nodeClass?.nameProperty &&
      property.value !== undefined &&
      property.value !== null &&
      property.value !== '',
  )
  return (
    <div data-slot="block-finder-preview-detail" className="flex flex-col gap-4">
      <div data-slot="block-finder-preview-heading" className="flex items-start gap-2">
        <ClassIcon icon={nodeClass?.icon} className="mt-0.5 size-5" />
        <div data-slot="block-finder-preview-title" className="grid min-w-0 gap-0.5">
          <p
            data-slot="block-finder-preview-name"
            className={cn(
              'font-medium break-words',
              detail.name === undefined && 'text-muted-foreground',
            )}
          >
            {detail.name ?? m.noName}
          </p>
          <p data-slot="block-finder-preview-class" className="text-xs text-muted-foreground">
            {nodeClass?.name ?? detail.class}
          </p>
        </div>
      </div>
      {properties.length > 0 ? (
        <dl data-slot="block-finder-preview-properties" className="grid gap-3 text-xs">
          {properties.map((property) => (
            <div
              key={property.key}
              data-slot="block-finder-preview-property"
              className="grid gap-0.5"
            >
              <dt data-slot="block-finder-preview-label" className="text-muted-foreground">
                {property.label}
              </dt>
              <dd
                data-slot="block-finder-preview-value"
                className="break-words whitespace-pre-wrap"
              >
                {formatFinderValue(property.value, property.kind, m.values)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

// ── Path and tray ─────────────────────────────────────────────────────────────────────────────

function PathBar() {
  const m = useContext(Messages)
  return (
    <FinderPath
      aria-label={m.location}
      className="flex h-8 min-w-0 shrink-0 items-center gap-0.5 overflow-hidden border-t px-2 text-xs text-muted-foreground"
    >
      {(segment, index) => (
        <>
          {index > 0 ? (
            <span data-slot="block-finder-path-separator" aria-hidden="true" className="px-0.5">
              ›
            </span>
          ) : null}
          <button
            type="button"
            data-slot="block-finder-path-segment"
            onClick={segment.go}
            className="flex min-w-0 shrink items-center gap-1.5 rounded px-1.5 py-0.5 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <PathSegment segment={segment} />
          </button>
        </>
      )}
    </FinderPath>
  )
}

function PathSegment({ segment }: { segment: FinderPathSegment }) {
  const m = useContext(Messages)
  switch (segment.kind) {
    case 'accepted':
      return (
        <>
          <ClassIcon icon={segment.classes[0]?.icon} className="size-3.5" />
          <span data-slot="block-finder-path-name" className="truncate">
            {m.allAccepted}
          </span>
        </>
      )
    case 'domain':
      return (
        <>
          <FinderIcon
            icon={segment.icon}
            fallback={initialsOf(segment.name)}
            className={cn(iconDomain, 'size-4')}
          />
          <span data-slot="block-finder-path-name" className="truncate">
            {segment.name}
          </span>
        </>
      )
    case 'classes':
      return segment.classes.map((item, index) => (
        <span
          key={item.key}
          data-slot="block-finder-path-class"
          className="flex min-w-0 items-center gap-1"
        >
          <ClassIcon icon={item.icon} className="size-3.5" />
          <span data-slot="block-finder-path-name" className="truncate">
            {item.name}
            {index < segment.classes.length - 1 ? ',' : ''}
          </span>
        </span>
      ))
    case 'rules':
      return m.filterCount(segment.count)
  }
}

function ConfirmError() {
  const { confirmation } = useFinder()
  const m = useContext(Messages)
  if (confirmation.status !== 'error') return null
  const { error } = confirmation
  return (
    <p
      data-slot="block-finder-confirm-error"
      role="alert"
      className="max-w-80 shrink truncate text-xs text-destructive"
      title={error instanceof Error && error.message ? error.message : undefined}
    >
      {error instanceof Error && error.message ? error.message : m.confirmFailed}
    </p>
  )
}

function Footer() {
  const finder = useFinder()
  const m = useContext(Messages)
  return (
    <div
      data-slot="block-finder-footer"
      className="flex shrink-0 items-center gap-3 border-t px-3 py-2.5"
    >
      <FinderTray
        aria-label={m.chosen}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
      >
        {(choice, nodeClass) => (
          <FinderChip
            choice={choice}
            className="flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-md border bg-background pr-0.5 pl-2 text-xs"
          >
            <ClassIcon icon={nodeClass?.icon} />
            <span data-slot="block-finder-chip-name" className="truncate">
              {choice.name}
            </span>
            <FinderChipRemove
              choice={choice}
              aria-label={m.remove(choice.name)}
              className={cn(iconButton, 'size-5')}
            >
              <Glyph path={CLOSE} className="size-3" />
            </FinderChipRemove>
          </FinderChip>
        )}
      </FinderTray>
      <ConfirmError />
      {finder.maximum > 1 ? (
        <span
          data-slot="block-finder-tally"
          className={cn(
            'shrink-0 text-xs text-muted-foreground tabular-nums',
            finder.maximumReached && 'text-foreground',
          )}
        >
          {m.tally(finder.chosen.length, finder.maximum)}
        </span>
      ) : null}
      <FinderCancel className={buttonVariants({ variant: 'outline' })}>{m.cancel}</FinderCancel>
      <FinderConfirm className={buttonVariants()} title={`${m.confirm} (⌘↵)`}>
        {m.confirm}
      </FinderConfirm>
    </div>
  )
}
