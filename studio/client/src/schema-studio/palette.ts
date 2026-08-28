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
  /** selected card fill — the same hue, barely there, but unmistakably not neutral */
  wash: string
}

type Part = keyof ModuleTint
/** lightness + chroma per part; the hue comes from the module. */
type Tone = [number, number]
const TONES: Record<'light' | 'dark', Record<Part, Tone>> = {
  light: {
    surface: [0.977, 0.014],
    border: [0.875, 0.04],
    text: [0.46, 0.09],
    mark: [0.58, 0.12],
    wash: [0.985, 0.022],
  },
  dark: {
    surface: [0.245, 0.022],
    border: [0.345, 0.04],
    text: [0.8, 0.07],
    mark: [0.74, 0.11],
    wash: [0.28, 0.035],
  },
}

const PARTS: Part[] = ['surface', 'border', 'text', 'mark', 'wash']

const tone = ([lightness, chroma]: Tone, hue: number) => `oklch(${lightness} ${chroma} ${hue})`

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
/** Rendered size of a view node — narrower and shorter than a class, so the two
 *  never read as the same kind of thing even before you reach their shapes. */
export const VIEW_W = 168
export const VIEW_H = 32
/** The view hue (matching `--schema-view`), for surfaces that need a literal colour. */
export const VIEW_HUE = 205
/** Module box insets: children start below the header, padded on every side. */
export const MODULE_HEADER = 38
export const MODULE_PAD = 18
export const MODULE_COLLAPSED_H = 34
/** Domain frame inset — even on every side. Unlike a module box the frame wears its
 *  origin ON the top edge, so there is no label to reserve room under. */
export const DOMAIN_PAD = 52
