/**
 * Logging Hook
 *
 * Provides a logging system for the host app.
 */

import { useCallback, useState } from "react";

import type { LogEntry, LogLevel } from "../types";

let logIdCounter = 0;

export interface UseLogsResult {
  logs: LogEntry[];
  log: (message: string, level?: LogLevel, data?: unknown) => void;
  clear: () => void;
}

export function useLogs(maxLogs = 500): UseLogsResult {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const log = useCallback(
    (message: string, level: LogLevel = "info", data?: unknown) => {
      const entry: LogEntry = {
        id: `log-${++logIdCounter}`,
        timestamp: new Date(),
        level,
        message,
        data,
      };

      setLogs((prev) => {
        const next = [...prev, entry];
        // Keep only the last maxLogs entries
        return next.length > maxLogs ? next.slice(-maxLogs) : next;
      });

      // Also log to console for debugging
      const consoleMethod =
        level === "error"
          ? console.error
          : level === "warning"
            ? console.warn
            : level === "debug"
              ? console.debug
              : console.log;
      consoleMethod(`[${level}] ${message}`, data ?? "");
    },
    [maxLogs],
  );

  const clear = useCallback(() => {
    setLogs([]);
  }, []);

  return { logs, log, clear };
}

/**
 * Creates a shell-compatible logger from the log function.
 */
export function createShellLogger(log: UseLogsResult["log"]) {
  return {
    debug: (msg: string, ctx?: unknown) => log(msg, "debug", ctx),
    info: (msg: string, ctx?: unknown) => log(msg, "info", ctx),
    warn: (msg: string, ctx?: unknown) => log(msg, "warning", ctx),
    error: (msg: string, ctx?: unknown) => log(msg, "error", ctx),
  };
}
