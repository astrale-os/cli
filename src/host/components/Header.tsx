/**
 * Header Component
 */

import type { AppConfig, AppManifest } from "../types"

interface HeaderProps {
  config: AppConfig | null
  manifest: AppManifest | null
}

export function Header({ config, manifest }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="header-logo">
          <span>⚡</span>
          <span>Astrale Dev</span>
        </div>
        {manifest && (
          <div className="header-app-info">
            <strong>{manifest.name}</strong>
            <span className="mono" style={{ marginLeft: 8, opacity: 0.6 }}>
              {manifest.slug}
            </span>
          </div>
        )}
      </div>
      <div className="header-actions">
        {config && (
          <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {config.appId.slice(0, 16)}...
          </span>
        )}
      </div>
    </header>
  )
}
