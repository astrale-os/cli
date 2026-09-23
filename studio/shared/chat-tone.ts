/**
 * chat-tone.ts — which colour slot a new conversation takes, for good.
 *
 * A tone is chosen ONCE, when the chat opens, and stored with it: closing a tab
 * must never re-colour the others, or the colour stops meaning "this
 * conversation". Slot 0 is the agent's own brand colour; slots 1..N are the
 * hues of the ring, which the client maps onto its palette.
 */

/** Hues in the ring after the brand — the client ships one class per slot. */
export const CHAT_TONE_RING = 5

/** The brand slot: the agent's own mark colour. */
export const BRAND_CHAT_TONE = 0

export function isChatTone(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * The tone a new `harness` chat takes next to the `open` ones (oldest first).
 *
 * The brand goes to the agent's first open chat — and back to the next one once
 * that chat is closed. Otherwise the ring hue the open tabs use least — the
 * lowest one, so a freed hue is reused first — and never the newest tab's hue
 * when another is just as free, so a new tab does not repeat its neighbour.
 */
export function nextChatTone(
  open: readonly { harness: string; tone?: number }[],
  harness: string,
): number {
  if (!open.some((chat) => chat.harness === harness && chat.tone === BRAND_CHAT_TONE))
    return BRAND_CHAT_TONE
  const used = Array.from({ length: CHAT_TONE_RING }, () => 0)
  let newest = -1
  for (const chat of open) {
    if (chat.tone === undefined || chat.tone === BRAND_CHAT_TONE) continue
    newest = (chat.tone - 1) % CHAT_TONE_RING
    used[newest]!++
  }
  // least used first, then anything but the newest tab's hue, then the lowest
  const rank = (slot: number) => used[slot]! * 2 + (slot === newest ? 1 : 0)
  let best = 0
  for (let slot = 1; slot < CHAT_TONE_RING; slot++) if (rank(slot) < rank(best)) best = slot
  return best + 1
}
