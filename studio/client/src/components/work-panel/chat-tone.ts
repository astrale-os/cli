/**
 * chat-tone.ts — one colour per open conversation.
 *
 * A tab is a logo, not a sentence, so two Claude chats side by side would be the
 * same 14 pixels twice. Colour is what tells them apart: the first tab of each
 * agent wears that agent's OWN colour — Claude's terracotta, OpenAI's black —
 * and every tab after it takes the next hue in the ring.
 *
 * Tones follow POSITION, not identity — closing a tab re-colours the ones after
 * it. That is deliberate: the strip stays a short, stable sequence of colours
 * instead of accumulating whatever hues happened to be handed out.
 */
import type { ChatInfo } from '@shared/types'

export interface ChatTone {
  /** the harness mark's colour */
  mark: string
  /** the selected tab's tinted background */
  surface: string
}

/** Tailwind needs these spelled out — a `text-chat-${n}` template compiles to nothing. */
const BRAND: Record<string, ChatTone> = {
  claude: { mark: 'text-brand-claude', surface: 'bg-brand-claude/12' },
  codex: { mark: 'text-brand-codex', surface: 'bg-accent' },
}

/** An agent Studio has no colour for — the panel's own ink says nothing wrong. */
export const NEUTRAL_TONE: ChatTone = { mark: 'text-foreground', surface: 'bg-accent' }

const TONES: ChatTone[] = [
  { mark: 'text-chat-1', surface: 'bg-chat-1/12' },
  { mark: 'text-chat-2', surface: 'bg-chat-2/12' },
  { mark: 'text-chat-3', surface: 'bg-chat-3/12' },
  { mark: 'text-chat-4', surface: 'bg-chat-4/12' },
  { mark: 'text-chat-5', surface: 'bg-chat-5/12' },
]

/**
 * An agent's own colour, wherever it is named outside the strip — the new-chat
 * menu, the model picker, Settings. A mark is a brand before it is a tab.
 */
export function brandTone(harness: string): ChatTone {
  return BRAND[harness] ?? NEUTRAL_TONE
}

/**
 * Colour the whole strip at once: the FIRST tab of each agent keeps that agent's
 * own mark colour, and everything after it draws from the ring.
 *
 * The ring advances per coloured tab rather than per position, so two neighbours
 * are never handed the same hue just because they sit at the same rank within
 * their own agent.
 */
export function chatTones(chats: ChatInfo[]): ChatTone[] {
  const branded = new Set<string>()
  let next = 0
  return chats.map((chat) => {
    if (!branded.has(chat.harness)) {
      branded.add(chat.harness)
      return brandTone(chat.harness)
    }
    return TONES[next++ % TONES.length]!
  })
}

/**
 * The tone of one chat by id — for anything outside the strip that points at a tab.
 *
 * `harness` is the fallback for a chat that is no longer open: the handoff chip
 * still has to name the agent its summary came from.
 */
export function toneOf(chats: ChatInfo[], chatId?: string, harness?: string): ChatTone {
  const index = chats.findIndex((chat) => chat.id === chatId)
  return index < 0 ? brandTone(harness ?? '') : chatTones(chats)[index]!
}
