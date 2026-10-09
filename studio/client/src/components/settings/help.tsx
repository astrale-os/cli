import { TOUR_STEPS } from '@/components/tour'
import { useUI } from '@/lib/store'

import { SettingRow, SettingsHeading } from './row'

/** The way back to the onboarding tour — the only way in, since it never starts itself. */
export function HelpSettings() {
  const setSettingsOpen = useUI((state) => state.setSettingsOpen)
  const setTourOpen = useUI((state) => state.setTourOpen)
  return (
    <div>
      <SettingsHeading>Help</SettingsHeading>
      <div className="divide-y rounded-lg border bg-card">
        <SettingRow
          label="Studio tour"
          description={`${TOUR_STEPS.length} short steps through the studio and Astrale's building blocks.`}
        >
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false)
              setTourOpen(true)
            }}
            className="h-8 w-52 rounded-md border bg-card px-2 text-[13px] transition-colors hover:bg-accent"
          >
            Start tour
          </button>
        </SettingRow>
      </div>
    </div>
  )
}
