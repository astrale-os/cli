import type { ChatInfo } from '@shared/types'

import { expect, test } from 'bun:test'

import { brandTone, chatTones, NEUTRAL_TONE, toneOf } from './chat-tone'

const chat = (id: string, harness = 'claude'): ChatInfo => ({
  id,
  title: 'New chat',
  harness,
  turns: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  status: 'idle',
  queued: [],
})

test('the first tab of each agent wears that agent\u2019s own colour', () => {
  const tones = chatTones([chat('a', 'codex'), chat('b'), chat('c'), chat('d', 'codex')])
  expect(tones[0]).toEqual(brandTone('codex'))
  expect(tones[1]).toEqual(brandTone('claude'))
  expect(brandTone('claude')).not.toEqual(brandTone('codex'))
  // the second tab of each agent is already off the brand
  expect(tones[2]).not.toEqual(brandTone('claude'))
  expect(tones[3]).not.toEqual(brandTone('codex'))
  // an agent Studio ships no colour for still has to render
  expect(brandTone('mock')).toBe(NEUTRAL_TONE)
})

test('neighbours never share a hue, whatever agent they run', () => {
  // two agents interleaved: the brand lands on the first tab of each, wherever
  // in the strip that falls, and nowhere else
  const chats = [chat('a'), chat('b'), chat('c', 'codex'), chat('d'), chat('e', 'codex')]
  const marks = chatTones(chats).map((tone) => tone.mark)
  expect(new Set(marks).size).toBe(marks.length)
  expect(marks[0]).toBe(brandTone('claude').mark)
  expect(marks[2]).toBe(brandTone('codex').mark)
  for (const index of [1, 3, 4])
    for (const brand of ['claude', 'codex']) expect(marks[index]).not.toBe(brandTone(brand).mark)
})

test('hues cycle rather than run out', () => {
  const many = Array.from({ length: 9 }, (_, index) => chat(`c${index}`))
  const marks = chatTones(many).map((tone) => tone.mark)
  // one brand + a ring of five, then the ring starts over
  expect(marks[1]).toBe(marks[6]!)
  expect(new Set(marks).size).toBe(6)
})

test('a chat is toned by the strip; a closed one falls back to its agent', () => {
  const chats = [chat('a', 'codex'), chat('b'), chat('c')]
  expect(toneOf(chats, 'a')).toEqual(brandTone('codex'))
  expect(toneOf(chats, 'b')).toEqual(brandTone('claude'))
  expect(toneOf(chats, 'c')).toEqual(chatTones(chats)[2]!)
  // the handoff chip outlives the tab it points at
  expect(toneOf(chats, 'gone', 'claude')).toEqual(brandTone('claude'))
  expect(toneOf(chats, undefined)).toBe(NEUTRAL_TONE)
})
