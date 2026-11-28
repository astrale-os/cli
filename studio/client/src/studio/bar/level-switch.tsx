/**
 * The Schema | Data switch: which level of the shown Domain the Studio reads. Schema is the
 * neutral default; Data wears the Data accent. It is the one control that moves between the two.
 * Data opens the dataset `studio/data/entry.ts` chooses, else the Domain's Datasets page; Schema
 * comes back with the lens and the selection kept. A Publication carries no dataset: its Data is
 * disabled and says why. A Domain that references no Dataset says so on the Data segment itself —
 * a glyph, when the agent can be asked for one.
 */

import type { DomainSummary } from '@shared/contracts/workspace'

import { useQuery } from '@tanstack/react-query'
import { DraftingCompass, type LucideIcon, Sparkles } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { bundleQueryOptions } from '@/lib/domain-queries'
import { useDatasets } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { DATA_GLYPH } from '../data/accent'
import { switchToData } from '../data/entry'
import { loadDataLevel } from '../data/load'
import { useAskForDataset } from '../data/no-dataset'

/** The keys that switch level, as the tooltips and ⌘K say them. */
export const LEVEL_SHORTCUTS = { schema: 'S', data: 'D' } as const

const PUBLICATION_HAS_NO_DATA =
  "A Publication carries no dataset: datasets are read from a Domain's sources."

const NO_DATASET = 'No Dataset referenced'
const ASK_DATASET = 'No Dataset referenced: the agent can be asked to write one'

const SEGMENT =
  'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-colors max-xl:px-2 disabled:cursor-default disabled:text-muted-foreground/55'

/** Below this width the segment not in use shows its glyph alone; its name stays its accessible name. */
const LABEL_NARROW = 'max-lg:sr-only'

export function LevelSwitch({
  domain,
  dataLevel,
  publication,
}: {
  /** the Domain shown, by id and origin */
  domain: Pick<DomainSummary, 'id' | 'origin'>
  /** the Data level is read, else the Schema */
  dataLevel: boolean
  /** the Domain shown is a Publication */
  publication: boolean
}) {
  const openSchema = useUI((s) => s.openSchema)
  // read, not asked: the Schema level asks for its bundle; the datasets build on it
  const schemaAnswered = !useQuery({ ...bundleQueryOptions(domain.id), enabled: false }).isPending
  const { data } = useDatasets(domain.id, {
    enabled: !publication && (dataLevel || schemaAnswered),
  })
  const { ask } = useAskForDataset(domain)
  const none = !publication && !!data && data.datasets.length === 0
  const hint = none && ask !== undefined
  const preload = () => void loadDataLevel()
  return (
    <div
      role="group"
      aria-label="Level"
      data-testid="level-switch"
      data-level={dataLevel ? 'data' : 'schema'}
      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5"
    >
      <Segment
        level="schema"
        label="Schema"
        icon={DraftingCompass}
        current={!dataLevel}
        onPick={openSchema}
        tip="Read what the Domain declares"
      />
      <Segment
        level="data"
        label="Data"
        icon={DATA_GLYPH}
        current={dataLevel}
        onPick={() => switchToData(domain.id)}
        onPreload={preload}
        tip={hint ? ASK_DATASET : none ? NO_DATASET : 'Read a dataset of the Domain'}
        {...(publication ? { unavailable: PUBLICATION_HAS_NO_DATA } : {})}
        {...(hint ? { hint: ASK_DATASET } : {})}
      />
    </div>
  )
}

function Segment({
  level,
  label,
  icon: Icon,
  current,
  onPick,
  onPreload,
  tip,
  unavailable,
  hint,
}: {
  level: keyof typeof LEVEL_SHORTCUTS
  label: string
  icon: LucideIcon
  current: boolean
  onPick: () => void
  onPreload?: () => void
  /** what the segment reads, in its tooltip */
  tip: string
  /** why it cannot be read: the segment is disabled, its tooltip says why */
  unavailable?: string
  /** a quiet note on the segment, its glyph labelled with it */
  hint?: string
}) {
  const disabled = unavailable !== undefined
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button gets no pointer events, so its tooltip hangs off a wrapper. */}
        <span className="inline-flex">
          <button
            type="button"
            aria-pressed={current}
            disabled={disabled}
            data-level={level}
            {...(hint ? { 'data-hint': 'ask-dataset' } : {})}
            onClick={onPick}
            onPointerEnter={onPreload}
            onFocus={onPreload}
            className={cn(
              SEGMENT,
              current
                ? level === 'data'
                  ? 'bg-primary text-primary-foreground shadow-[0_1px_2px_rgb(0_0_0/0.12)]'
                  : 'bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className={current ? undefined : LABEL_NARROW}>{label}</span>
            {hint && (
              <Sparkles
                role="img"
                aria-label={hint}
                className={cn('h-3.5 w-3.5 shrink-0', current ? 'opacity-80' : 'text-primary/80')}
              />
            )}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72">
        {unavailable === undefined ? (
          <>
            {tip}
            <span className="ml-1.5 text-muted-foreground">{LEVEL_SHORTCUTS[level]}</span>
          </>
        ) : (
          <span data-level-reason={level}>{unavailable}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
