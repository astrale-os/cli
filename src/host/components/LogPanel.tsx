/**
 * Log Panel Component
 */

import { useEffect, useRef } from "react";

import type { LogEntry } from "../types";

interface LogPanelProps {
  logs: LogEntry[];
  onClear: () => void;
}

function formatTime(date: Date): string {
  return date.toISOString().split("T")[1]?.slice(0, 12) ?? "";
}

export function LogPanel({ logs, onClear }: LogPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="log-panel">
      <div className="panel-header">
        <span>📋 Logs ({logs.length})</span>
        <button className="btn btn-ghost btn-sm" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="log-content" ref={contentRef}>
        {logs.length === 0 ? (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: "var(--text-muted)",
            }}
          >
            No logs yet
          </div>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className={`log-entry log-${entry.level}`}>
              <span className="log-time">{formatTime(entry.timestamp)}</span>
              {entry.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
