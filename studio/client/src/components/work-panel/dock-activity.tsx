/**
 * dock-activity.tsx — the only sign a closed dock gives that the agent is working.
 *
 * Docked left or right, a running turn is never out of sight: the transcript is
 * open beside the view, and the header carries "Agent working…" when the column
 * is collapsed. The bottom dock has neither — it closes down to one bar over the
 * canvas, and the header drops that button precisely because the bar is always
 * there. So the bar has to say it itself, in the width of a word: the agent's own
 * mark, turning, and how long it has been at it.
 *
 * The mark turns at the tab strip's four seconds, not a loader's one: the same
 * movement has to mean the same thing wherever the studio shows it, and at a
 * loader's speed this reads as a wait rather than as work.
 */
import type { AgentRun } from '@shared/types'

import { RunElapsed } from '@/components/agent-activity'
import { hasHarnessLogo, HarnessLogo } from '@/components/harness-logo'
import { cn } from '@/lib/utils'

import type { ChatTone } from './chat-tone'

/**
 * What the agent is, and how long this turn has run — the resting bar's whole
 * report. It says WHICH agent because a domain runs several: the mark is the one
 * on its tab, in that tab's colour, so a glance ties the two together.
 */
export function DockActivity({
  run,
  harness,
  tone,
}: {
  run: AgentRun | null
  harness: string
  tone: ChatTone
}) {
  return (
    <span
      data-testid="dock-activity"
      className="flex shrink-0 items-center gap-1.5 px-1 text-[11px] text-muted-foreground"
    >
      <WorkingMark harness={harness} tone={tone} />
      <RunElapsed run={run} />
    </span>
  )
}

/**
 * The agent at work: its mark turning, or a breathing dot when the studio has no
 * mark for it — the tab strip's own two answers, at the tab strip's own speeds.
 *
 * The duration rides a plain utility rather than a `motion-safe:` one on purpose:
 * a variant puts Tailwind's `animation` shorthand after it in the sheet, and the
 * shorthand resets the duration it was meant to override — the mark then spins at
 * a loader's second. What movement cannot say, `aria-busy` on the dock says.
 */
function WorkingMark({ harness, tone }: { harness: string; tone: ChatTone }) {
  if (!hasHarnessLogo(harness))
    return (
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary [animation-duration:2.4s]"
      />
    )
  return (
    <HarnessLogo
      harness={harness}
      className={cn('h-3 w-3', tone.mark, 'animate-spin [animation-duration:4s]')}
    />
  )
}
