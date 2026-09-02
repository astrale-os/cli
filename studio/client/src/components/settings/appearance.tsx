import { type EdgeStyle, type Theme, useUI } from '@/lib/store'

import { SettingRow, SettingSelect } from './row'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const EDGE_STYLES: { value: EdgeStyle; label: string }[] = [
  { value: 'curved', label: 'Curved' },
  { value: 'orthogonal', label: 'Right angles' },
]

/** Visual preferences: theme follows the browser; canvas geometry follows the workspace. */
export function AppearanceSettings() {
  const theme = useUI((state) => state.theme)
  const setTheme = useUI((state) => state.setTheme)
  const edgeStyle = useUI((state) => state.edgeStyle)
  const setEdgeStyle = useUI((state) => state.setEdgeStyle)
  return (
    <div>
      <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Appearance
      </div>
      <div className="divide-y rounded-lg border bg-card">
        <SettingRow label="Theme" description="Applies to this browser, saved on change.">
          <SettingSelect value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            {THEMES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SettingSelect>
        </SettingRow>
        <SettingRow
          label="Edges"
          description="How this workspace's Schema and Tests canvases draw relationships."
        >
          <SettingSelect
            value={edgeStyle}
            onChange={(event) => setEdgeStyle(event.target.value as EdgeStyle)}
          >
            {EDGE_STYLES.map((option) => (
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
