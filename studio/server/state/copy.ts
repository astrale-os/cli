/**
 * copy.ts — the copy-payload builder. A PURE function (no IO): it turns studio
 * state into a single Markdown handoff payload that an author agent can paste
 * into its own session. The payload ends with a fenced ```json``` machine-state
 * block in the annotate shape so the author can reply by appending
 * {role:'author'} thread entries and merging back by id.
 */
import type { Comment, ContextItem, DocMeta, ThreadEntry } from '../../shared/types'

interface CopyParts {
  origin: string
  root: string
  schemaHash: string
  openComments: Comment[]
  userContext: ContextItem[]
  autoContext: ContextItem[]
  documents?: DocMeta[]
}

function primaryAnchor(comment: Comment): { ref: string; file?: string } | null {
  const ref = comment.anchorRefs?.[0]
  if (!ref) return null
  return { ref: ref.ref, file: ref.file }
}

function latestThreadEntry(comment: Comment): ThreadEntry | null {
  const thread = comment.thread ?? []
  return thread.length > 0 ? thread[thread.length - 1] : null
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return 'unknown size'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** annotate machine-state projection of a comment: {id, anchors, status, thread}. */
function toMachineState(comment: Comment): {
  id: string
  anchors: string[]
  status: 'open' | 'closed'
  thread: ThreadEntry[]
} {
  return {
    id: comment.id,
    anchors: comment.anchors ?? [],
    status: comment.status,
    thread: (comment.thread ?? []).map((t) => {
      const entry: ThreadEntry = {
        id: t.id,
        role: t.role,
        type: t.type,
        text: t.text,
      }
      if (t.options !== undefined) entry.options = t.options
      if (t.answer !== undefined) entry.answer = t.answer
      return entry
    }),
  }
}

export function buildCopyMarkdown(parts: CopyParts): string {
  const { origin, root, schemaHash, openComments, userContext, autoContext, documents = [] } = parts
  const lines: string[] = []

  // ── Header ──
  lines.push(`# Domain handoff — ${origin}`)
  lines.push('')
  lines.push(`- **Origin:** \`${origin}\``)
  lines.push(`- **Repo root:** \`${root}\``)
  lines.push(`- **Schema hash:** \`${schemaHash}\``)
  lines.push('')
  lines.push(
    'Load the **astrale-domain** skill, use the context/threads below, ' +
      'read any listed context documents if relevant, edit code on disk, and reply by appending one `{role:"author"}` entry per open thread ' +
      '(merge by `id`). Resolve a thread by adding a closing note plus `"status":"closed"`; ' +
      'a thread whose last entry is not yours will be resent.',
  )
  lines.push('')

  // ── Context documents (paths only; contents stay on disk for the agent to read on demand) ──
  if (documents.length > 0) {
    lines.push('## Context documents')
    lines.push('')
    for (const doc of documents) {
      const type = doc.type || 'application/octet-stream'
      lines.push(
        `- \`.domain-studio/${doc.stored}\` — ${doc.name} (${type}, ${formatBytes(doc.size)})`,
      )
    }
    lines.push('')
  }

  // ── Saved context notes ──
  if (userContext.length > 0) {
    lines.push('## Saved context notes')
    lines.push('')
    for (const item of userContext) {
      lines.push(`### ${item.title}`)
      lines.push('')
      lines.push(item.body)
      lines.push('')
    }
  }

  // ── Context (auto) — optional, caller already filtered ──
  if (autoContext.length > 0) {
    lines.push('## Auto context')
    lines.push('')
    for (const item of autoContext) {
      lines.push(`### ${item.title}`)
      lines.push('')
      lines.push(item.body)
      lines.push('')
    }
  }

  // ── Open comments & questions ──
  lines.push('## Open comments & questions')
  lines.push('')
  if (openComments.length === 0) {
    lines.push('_none_')
    lines.push('')
  } else {
    openComments.forEach((comment, i) => {
      const anchor = primaryAnchor(comment)
      const latest = latestThreadEntry(comment)
      const head = `${i + 1}. **${comment.kind}**`
      const where = anchor ? ` — \`${anchor.ref}\`${anchor.file ? ` (${anchor.file})` : ''}` : ''
      lines.push(`${head}${where}`)
      if (latest) {
        lines.push(`   - ${latest.role}: ${latest.text}`)
        if (latest.type === 'choice') {
          if (latest.options && latest.options.length > 0) {
            lines.push(`   - options: ${latest.options.join(', ')}`)
          }
          lines.push(`   - answer: ${latest.answer ?? '(unanswered)'}`)
        }
      }
      lines.push('')
    })
  }

  // ── Trailing machine-state block ──
  const machineState = {
    schemaVersion: schemaHash,
    comments: openComments.map(toMachineState),
  }
  lines.push('```json')
  lines.push(JSON.stringify(machineState, null, 2))
  lines.push('```')
  lines.push('')

  return lines.join('\n')
}
