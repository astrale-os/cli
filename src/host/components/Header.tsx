import type { AppConfig, AppManifest } from '../types'

interface HeaderProps {
  config: AppConfig | null
  manifest: AppManifest | null
}

export function Header({ config, manifest }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="header-logo">
          <span>Astrale Dev</span>
        </div>
        {manifest && (
          <div className="header-app-info">
            <strong>{manifest.name}</strong>
            <span style={{ opacity: 0.6 }}>{manifest.slug}</span>
          </div>
        )}
      </div>
      <div>{config && <span className="header-app-id">{config.appId.slice(0, 16)}...</span>}</div>
    </header>
  )
}
