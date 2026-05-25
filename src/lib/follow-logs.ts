import chalk from 'chalk'
/**
 * Live log streaming for `astrale domain dev up`. Tails the detached
 * wrangler worker log(s) to stdout — prefixed with a timestamp + domain slug
 * so a reload loop (wrangler's `⎔ Reloading…` lines carry no time of their
 * own) is obvious at a glance — until the user hits Ctrl-C.
 *
 * Poll-based (stat the file size each tick) rather than `fs.watch`: robust
 * for append detection across platforms and needs no `tail` binary (the dev
 * lifecycle already avoids relying on external tools in the macOS-TCC path).
 *
 * It only *reads* the log file — the worker is a separate detached process, so
 * stopping the follow (Ctrl-C) never touches the worker.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs'

import { log } from './log'

export type FollowEntry = { label: string; file: string }

const POLL_MS = 250

function hhmmss(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * Stream appended lines of each `file` to stdout until SIGINT. On Ctrl-C:
 * stop polling, flush partial lines, print `stopNote`, exit(0). The promise
 * never resolves on its own — following is the terminal phase of `dev up`.
 */
export function followLogs(entries: FollowEntry[], stopNote: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const width = Math.max(0, ...entries.map((e) => e.label.length))
    // Per-file read cursor (seeded at EOF → stream only new output) + a buffer
    // holding the trailing partial line until its newline arrives.
    const cursors = entries.map((e) => {
      let offset = 0
      try {
        offset = statSync(e.file).size
      } catch {
        // File not yet created (worker still starting) — start at 0.
      }
      return { label: e.label, file: e.file, offset, buf: '' }
    })

    function emit(label: string, line: string): void {
      process.stdout.write(`${chalk.dim(`${hhmmss()} ${label.padEnd(width)} │ `)}${line}\n`)
    }

    function pump(c: (typeof cursors)[number]): void {
      let size: number
      try {
        size = statSync(c.file).size
      } catch {
        return // file briefly absent (worker restarting) — retry next tick
      }
      if (size < c.offset) {
        // Truncated/rotated (a `dev up` restart re-opens the log with `>`) —
        // re-read from the top.
        c.offset = 0
        c.buf = ''
      }
      if (size === c.offset) return
      const len = size - c.offset
      const fd = openSync(c.file, 'r')
      try {
        const chunk = Buffer.alloc(len)
        const read = readSync(fd, chunk, 0, len, c.offset)
        c.offset += read
        c.buf += chunk.subarray(0, read).toString('utf-8')
      } finally {
        closeSync(fd)
      }
      const lines = c.buf.split('\n')
      c.buf = lines.pop() ?? ''
      for (const line of lines) emit(c.label, line)
    }

    log.step(
      `following ${entries.map((e) => e.label).join(', ')} — Ctrl-C to stop (worker keeps running)`,
    )
    const timer = setInterval(() => {
      for (const c of cursors) pump(c)
    }, POLL_MS)

    process.once('SIGINT', () => {
      clearInterval(timer)
      for (const c of cursors) if (c.buf) emit(c.label, c.buf)
      log.step(stopNote)
      resolve()
      process.exit(0)
    })
  })
}
