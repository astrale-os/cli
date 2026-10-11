import { type ChatTabsSide, type EdgeStyle, type Theme, useUI } from '@/lib/store'

import { SettingRow, SettingSelect, SettingsHeading } from './controls'

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
  { value: 'left', label: 'Left, with titles' },
  { value: 'top', label: 'Top' },
  { value: 'top-titled', label: 'Top, with titles' },
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
          <SettingSelect value={theme} options={THEMES} onValue={setTheme} />
        </SettingRow>
        <SettingRow
          label="Edges"
          description="How this workspace's Schema and Tests canvases draw relationships."
        >
          <SettingSelect value={edgeStyle} options={EDGE_STYLES} onValue={setEdgeStyle} />
        </SettingRow>
        <SettingRow
          label="Chat tabs"
          description="In a resizable column beside the conversation, or above it with or without each title. Applies to this browser."
        >
          <SettingSelect value={chatTabsSide} options={CHAT_TABS} onValue={setChatTabsSide} />
        </SettingRow>
      </div>
    </div>
  )
}
