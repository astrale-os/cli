import type { AnchorRef } from '@shared/types'

import { create } from 'zustand'

import { streamAsk } from './ask'

/**
 * Ephemeral "Ask" state. Unlike comments (persisted to comments.json), an ask lives
 * ONLY in client memory and is gone on refresh. It behaves like a comment otherwise:
 * a dot sits on the element; you can ask, close the popover, do other things, and the
 * answer streams in the BACKGROUND (the stream runs here in the store, not in the
 * popover) — the dot flips to "answer ready" so you can come back to it.
 *
 * One ask per element (keyed by domain::ref). Re-asking on the same element reuses it.
 */
export type AskStatus = 'composing' | 'streaming' | 'done' | 'error'

export interface AskEntry {
  key: string
  ref: string
  domainId: string
  anchor: AnchorRef
  excerpt: string
  /** click point — fallback dot position when the target element isn't on screen */
  x: number
  y: number
  question: string
  answer: string
  status: AskStatus
  error?: string
  /** false ⇒ a finished answer hasn't been looked at yet (drives the "new" dot) */
  seen: boolean
}

const keyOf = (domainId: string, ref: string) => `${domainId}::${ref}`
const controllers = new Map<string, AbortController>()

interface AsksState {
  entries: Record<string, AskEntry>
  /** which ask's popover is expanded (null ⇒ all collapsed to dots) */
  openKey: string | null
  start: (domainId: string, anchor: AnchorRef, excerpt: string, x: number, y: number) => void
  submit: (key: string, question: string) => void
  recompose: (key: string) => void
  open: (key: string) => void
  collapse: () => void
  remove: (key: string) => void
  keepOnly: (domainId: string) => void
}

export const useAsks = create<AsksState>((set, get) => ({
  entries: {},
  openKey: null,

  // ask-mode click → create (or reopen) the ask for this element and expand it
  start: (domainId, anchor, excerpt, x, y) => {
    const key = keyOf(domainId, anchor.ref)
    set((s) => {
      const existing = s.entries[key]
      const entry: AskEntry = existing
        ? { ...existing, x, y, seen: true }
        : {
            key,
            ref: anchor.ref,
            domainId,
            anchor,
            excerpt,
            x,
            y,
            question: '',
            answer: '',
            status: 'composing',
            seen: true,
          }
      return { entries: { ...s.entries, [key]: entry }, openKey: key }
    })
  },

  // fire the forked side-question; the stream runs HERE so it survives the popover closing
  submit: (key, question) => {
    const e = get().entries[key]
    if (!e) return
    controllers.get(key)?.abort()
    const ctrl = new AbortController()
    controllers.set(key, ctrl)
    set((s) => ({
      entries: {
        ...s.entries,
        [key]: { ...e, question, answer: '', status: 'streaming', error: undefined, seen: true },
      },
    }))

    const patch = (fn: (cur: AskEntry) => AskEntry) =>
      set((s) => {
        const cur = s.entries[key]
        if (!cur) return s
        return { entries: { ...s.entries, [key]: fn(cur) } }
      })

    streamAsk(
      e.domainId,
      { anchor: e.anchor, excerpt: e.excerpt, question },
      (chunk) => {
        if (!ctrl.signal.aborted) patch((cur) => ({ ...cur, answer: cur.answer + chunk }))
      },
      ctrl.signal,
    )
      .then((r) => {
        if (ctrl.signal.aborted) return
        // mark unseen only if the popover for this ask isn't currently open
        patch((cur) => ({
          ...cur,
          status: r.error ? 'error' : 'done',
          error: r.error,
          answer: cur.answer || r.text,
          seen: get().openKey === key,
        }))
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        patch((cur) => ({
          ...cur,
          status: 'error',
          error: String(err),
          seen: get().openKey === key,
        }))
      })
  },

  // "Ask another" — back to the composer for a fresh question on the same element
  recompose: (key) => {
    controllers.get(key)?.abort()
    set((s) => {
      const cur = s.entries[key]
      if (!cur) return s
      return {
        entries: {
          ...s.entries,
          [key]: {
            ...cur,
            question: '',
            answer: '',
            status: 'composing',
            error: undefined,
            seen: true,
          },
        },
      }
    })
  },

  open: (key) =>
    set((s) => ({
      openKey: key,
      entries: s.entries[key]
        ? { ...s.entries, [key]: { ...s.entries[key], seen: true } }
        : s.entries,
    })),

  collapse: () => set({ openKey: null }),

  remove: (key) => {
    controllers.get(key)?.abort()
    controllers.delete(key)
    set((s) => {
      const { [key]: _gone, ...rest } = s.entries
      return { entries: rest, openKey: s.openKey === key ? null : s.openKey }
    })
  },

  // asks are scoped to the domain they were opened in — abort + drop the rest on a switch
  keepOnly: (domainId) =>
    set((s) => {
      const entries: Record<string, AskEntry> = {}
      for (const [k, e] of Object.entries(s.entries)) {
        if (e.domainId === domainId) entries[k] = e
        else {
          controllers.get(k)?.abort()
          controllers.delete(k)
        }
      }
      return { entries, openKey: s.openKey && entries[s.openKey] ? s.openKey : null }
    }),
}))
