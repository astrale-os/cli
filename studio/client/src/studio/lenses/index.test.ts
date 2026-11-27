import { describe, expect, test } from 'bun:test'

import { OPTION_GLYPHS } from '../canvas/glyphs'
import { LENSES } from './index'

describe('lens options', () => {
  test('no two toggles of one lens look alike', () => {
    for (const lens of LENSES) {
      const pictures = lens.options.map((option) => OPTION_GLYPHS[option.icon])
      expect(pictures.every(Boolean)).toBe(true)
      expect(new Set(pictures).size).toBe(pictures.length)
    }
  })
})
