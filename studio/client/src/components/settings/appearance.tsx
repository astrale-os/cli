import { type Theme, useUI } from '@/lib/store'

import { SettingRow, SettingSelect } from './row'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** The one preference that never reaches settings.json — it belongs to this browser. */
export function AppearanceSettings() {
  const theme = useUI((state) => state.theme)
  const setTheme = useUI((state) => state.setTheme)
  return (
    <div>
      <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Appearance
      </div>
      <div className="rounded-lg border bg-card">
        <SettingRow label="Theme" description="Applies to this browser, saved on change.">
          <SettingSelect value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            {THEMES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SettingSelect>
        </SettingRow>
      </div>
    </div>
  )
}
