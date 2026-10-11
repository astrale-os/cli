import type { ChatInfo } from '@shared/contracts/agent'

import { CHAT_TONE_RING } from '@shared/chat-tone'
import { expect, test } from 'bun:test'

import { brandTone, chatTones, NEUTRAL_TONE, toneOf } from './chat-tone'

const chat = (id: string, harness = 'claude', tone?: number) =>
  ({ id, harness, ...(tone === undefined ? {} : { tone }) }) as ChatInfo

test('the first tab of each agent wears its brand; neighbours never share a hue', () => {
  const chats = [chat('a'), chat('b'), chat('c', 'codex'), chat('d'), chat('e', 'codex')]
  const marks = chatTones(chats).map((tone) => tone.mark)
  expect(new Set(marks).size).toBe(marks.length)
  expect(marks[0]).toBe(brandTone('claude').mark)
  expect(marks[2]).toBe(brandTone('codex').mark)
  // an agent Studio ships no colour for still renders
  expect(brandTone('mock')).toBe(NEUTRAL_TONE)
})

test('a stored slot names one colour of the ring, and the ring starts over', () => {
  const slot = (tone: number) => chatTones([chat('a', 'claude', tone)])[0]!.mark
  const ring = Array.from({ length: CHAT_TONE_RING }, (_, index) => slot(index + 1))
  expect(new Set(ring).size).toBe(CHAT_TONE_RING)
  expect(slot(CHAT_TONE_RING + 1)).toBe(ring[0]!)
  expect(slot(0)).toBe(brandTone('claude').mark)
})

test('a closed chat falls back to its agent, so the handoff chip outlives its tab', () => {
  const chats = [chat('a', 'codex'), chat('b')]
  expect(toneOf(chats, 'b')).toEqual(brandTone('claude'))
  expect(toneOf(chats, 'gone', 'claude')).toEqual(brandTone('claude'))
  expect(toneOf(chats, undefined)).toBe(NEUTRAL_TONE)
})
