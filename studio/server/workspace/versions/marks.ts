/**
 * The lines a platform command (`astrale-domain`) composes for a person on stderr: `›` marks
 * progress, `!` a warning, `✗` a refusal, and a line indented by two spaces continues the marked
 * line before it. Anything else (a bundler's, an adapter's or a tool's own output) is unmarked:
 * counted, never relayed, so nothing the platform did not compose for a caller reaches one.
 */

export type MarkTone = 'step' | 'warning' | 'refusal'

export interface MarkedLine {
  tone: MarkTone
  /** The line without its mark or colours; a continuation keeps its two-space indent. */
  line: string
  /** It continues the marked line before it. */
  continues: boolean
}

const ANSI = /\x1b\[[0-9;]*m/g
const MARKS: ReadonlyArray<readonly [string, MarkTone]> = [
  ['› ', 'step'],
  ['! ', 'warning'],
  ['✗ ', 'refusal'],
]

/** Reads stderr chunk by chunk and emits each marked line as soon as it is complete. */
export class MarkedLineReader {
  private partial = ''
  private tone: MarkTone | undefined
  /** Lines the platform did not mark. */
  unmarked = 0

  constructor(private readonly emit: (line: MarkedLine) => void) {}

  push(chunk: string): void {
    const lines = (this.partial + chunk).split(/\r?\n/)
    this.partial = lines.pop() ?? ''
    for (const line of lines) this.read(line)
  }

  end(): void {
    if (this.partial !== '') this.read(this.partial)
    this.partial = ''
  }

  private read(raw: string): void {
    const line = raw.replace(ANSI, '')
    if (line.trim() === '') return
    const mark = MARKS.find(([prefix]) => line.startsWith(prefix))
    if (mark !== undefined) {
      this.tone = mark[1]
      this.emit({ tone: mark[1], line: line.slice(mark[0].length), continues: false })
    } else if (this.tone !== undefined && line.startsWith('  ')) {
      this.emit({ tone: this.tone, line, continues: true })
    } else {
      this.tone = undefined
      this.unmarked += 1
    }
  }
}

/** Every marked message of a finished run, continuations joined to their line. */
export function markedMessages(stderr: string): Array<{ tone: MarkTone; message: string }> {
  const messages: Array<{ tone: MarkTone; message: string }> = []
  const reader = new MarkedLineReader(({ tone, line, continues }) => {
    const last = messages.at(-1)
    if (continues && last !== undefined) last.message += `\n${line}`
    else messages.push({ tone, message: line })
  })
  reader.push(stderr)
  reader.end()
  return messages
}
