import { expect, test } from 'bun:test'

import { BRAND_CHAT_TONE, CHAT_TONE_RING, nextChatTone } from './chat-tone'

const open = (...chats: [string, number][]) => chats.map(([harness, tone]) => ({ harness, tone }))

test('the first chat of an agent takes its brand, the next ones the ring', () => {
  expect(nextChatTone([], 'claude')).toBe(BRAND_CHAT_TONE)
  expect(nextChatTone(open(['claude', 0]), 'codex')).toBe(BRAND_CHAT_TONE)
  expect(nextChatTone(open(['claude', 0]), 'claude')).toBe(1)
  expect(nextChatTone(open(['claude', 0], ['claude', 1]), 'claude')).toBe(2)
})

test('a closed brand chat hands the brand to the next one of its agent', () => {
  expect(nextChatTone(open(['claude', 1], ['claude', 2]), 'claude')).toBe(BRAND_CHAT_TONE)
})

test('a new tab takes a free hue and never its neighbour’s', () => {
  // slot 1 was closed: it is the free one, not the neighbour's 3
  expect(nextChatTone(open(['claude', 0], ['claude', 2], ['claude', 3]), 'claude')).toBe(1)
  // every hue taken once: the one after the newest, not a repeat of it
  const full = open(
    ['claude', 0],
    ...Array.from({ length: CHAT_TONE_RING }, (_, index): [string, number] => [
      'claude',
      index + 1,
    ]),
  )
  expect(nextChatTone(full, 'claude')).toBe(1)
  expect(nextChatTone(open(['claude', 0], ['claude', 1], ['claude', 2]).reverse(), 'claude')).toBe(
    3,
  )
})
