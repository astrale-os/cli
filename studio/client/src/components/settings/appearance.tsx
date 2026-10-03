import { type ChatTabsSide, type EdgeStyle, type Theme, useUI } from '@/lib/store'

import { SettingRow, SettingSelect, SettingsHeading } from './row'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const EDGE_STYLES: { value: EdgeStyle; label: string }[] = [
  { value: 'curved', label: 'Curved' },
  { value: 'orthogonal', label: 'Right angles' },
]

const CHAT_TABS: { value: ChatTabsSide; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'left', label: 'Left, with titles' },
]

/** Visual preferences: theme follows the browser; canvas geometry follows the workspace. */
export function AppearanceSettings() {
  const theme = useUI((state) => state.theme)
  const setTheme = useUI((state) => state.setTheme)
  const edgeStyle = useUI((state) => state.edgeStyle)
  const setEdgeStyle = useUI((state) => state.setEdgeStyle)
  const chatTabsSide = useUI((state) => state.chatTabsSide)
  const setChatTabsSide = useUI((state) => state.setChatTabsSide)
  return (
    <div>
      <SettingsHeading>Appearance</SettingsHeading>
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
        <SettingRow
          label="Chat tabs"
          description="Above the conversation, or in a column beside it with the start of each title. Applies to this browser."
        >
          <SettingSelect
            value={chatTabsSide}
            onChange={(event) => setChatTabsSide(event.target.value as ChatTabsSide)}
          >
            {CHAT_TABS.map((option) => (
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
