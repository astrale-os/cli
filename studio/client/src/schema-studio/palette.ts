/**
 * Canvas palette + metrics.
 *
 * Modules carry a hue so a reader can tell two boxes apart at a glance; every
 * tint is derived here so the canvas stays legible on both themes and a single
 * change repaints it. Node metrics live here too because the layout engine must
 * reserve exactly what the DOM renders — a mismatch is what makes a graph look
 * full of holes.
 */

export interface ModuleTint {
  /** module box fill */
  surface: string
  /** module box border */
  border: string
  /** module label */
  text: string
  /** the class node's leading bar + icon */
  mark: string
}

type Part = keyof ModuleTint
/** lightness + chroma per part; the hue comes from the module. */
const TONES: Record<'light' | 'dark', Record<Part, [number, number]>> = {
  light: {
    surface: [0.977, 0.014],
    border: [0.875, 0.04],
    text: [0.46, 0.09],
    mark: [0.58, 0.12],
  },
  dark: {
    surface: [0.245, 0.022],
    border: [0.345, 0.04],
    text: [0.8, 0.07],
    mark: [0.74, 0.11],
  },
}

const PARTS: Part[] = ['surface', 'border', 'text', 'mark']

const tone = ([lightness, chroma]: [number, number], hue: number) =>
  `oklch(${lightness} ${chroma} ${hue})`

/**
 * Tint for a module hue. Without a scheme the colour is a `light-dark()` pair —
 * the browser picks the side, so a theme switch repaints without re-rendering.
 * Pass a scheme where the value lands in an SVG *attribute* (the minimap), which
 * would not resolve a CSS function.
 */
export function moduleTint(hue: number, scheme?: 'light' | 'dark'): ModuleTint {
  const paint = (part: Part) =>
    scheme
      ? tone(TONES[scheme][part], hue)
      : `light-dark(${tone(TONES.light[part], hue)}, ${tone(TONES.dark[part], hue)})`
  return Object.fromEntries(PARTS.map((part) => [part, paint(part)])) as unknown as ModuleTint
}

/** Rendered size of a class node — the layout contract (see elk-layout.ts). */
export const CLASS_W = 184
export const CLASS_H = 40
/** Module box insets: children start below the header, padded on every side. */
export const MODULE_HEADER = 38
export const MODULE_PAD = 18
export const MODULE_COLLAPSED_H = 34
