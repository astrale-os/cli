/**
 * Window Panel Component
 *
 * Manages app windows and iframe display.
 */

import { useState } from "react";

import type { IframeRef } from "../lib/shell-adapter";
import type { AppConfig, WindowInfo } from "../types";

interface WindowPanelProps {
  config: AppConfig;
  windows: WindowInfo[];
  pendingIframes: Map<
    string,
    { src: string; onWindowReady: (win: Window) => void }
  >;
  iframeRefs: Map<string, IframeRef>;
  onOpenWindow: () => void;
  onCloseWindow: (nodeId: string) => void;
  registerIframeRef: (nodeId: string, el: HTMLIFrameElement | null) => void;
  disabled: boolean;
}

export function WindowPanel({
  config,
  windows,
  pendingIframes,
  onOpenWindow,
  onCloseWindow,
  registerIframeRef,
  disabled,
}: WindowPanelProps) {
  const [selectedWindow, setSelectedWindow] = useState<string | null>(null);

  // Auto-select first window if none selected
  const activeWindow =
    selectedWindow && windows.find((w) => w.nodeId === selectedWindow)
      ? selectedWindow
      : (windows[0]?.nodeId ?? null);

  // Get all windows that need iframes (either in windows list or pending)
  const allWindowIds = new Set([
    ...windows.map((w) => w.nodeId),
    ...pendingIframes.keys(),
  ]);

  return (
    <div className="window-panel">
      <div className="window-controls">
        <button
          className="btn btn-primary"
          onClick={onOpenWindow}
          disabled={disabled}
        >
          <span>🪟</span>
          <span>Open Window</span>
        </button>

        {windows.length > 0 && (
          <div className="window-tabs">
            {windows.map((win) => (
              <div
                key={win.nodeId}
                className={`window-tab ${activeWindow === win.nodeId ? "active" : ""}`}
                onClick={() => setSelectedWindow(win.nodeId)}
              >
                <span className="truncate" style={{ maxWidth: 100 }}>
                  {win.nodeId.slice(-8)}
                </span>
                <button
                  className="window-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseWindow(win.nodeId);
                    if (selectedWindow === win.nodeId) {
                      setSelectedWindow(null);
                    }
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="iframe-container">
        {allWindowIds.size === 0 ? (
          <div className="iframe-empty">
            <div className="iframe-empty-icon">🖼️</div>
            <div>No windows open</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Click "Open Window" to start
            </div>
          </div>
        ) : (
          Array.from(allWindowIds).map((nodeId) => {
            const pending = pendingIframes.get(nodeId);
            const src = pending?.src ?? config.uiUrl;

            return (
              <iframe
                key={nodeId}
                ref={(el) => registerIframeRef(nodeId, el)}
                src={src}
                title={`Window ${nodeId}`}
                className={activeWindow === nodeId ? "" : "hidden"}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
