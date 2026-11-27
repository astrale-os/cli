/**
 * The stage: a band docked at the foot of the canvas pane that shows what the Inspector's column
 * is too narrow for — a rule's walk, step by step, beside its Figure. The Inspector stages it
 * (`Staged`); the panel beside the canvas draws the band (`StageDock`) while something is staged.
 * Whether it is open and how tall it stands are this browser's, kept across reloads; until the
 * reader sets its height, it stands at a share of the view. Whether it is enlarged over the
 * canvas lasts until it is put back.
 */

import { create } from 'zustand'

/**
 * The band's height: the least it stands at, in px, and until the reader sets it, the share of
 * the view it takes, never less than `least`.
 */
export const STAGE_HEIGHT = { min: 180, least: 360, share: 0.45 } as const
/** The least of the canvas the band leaves above it, below the canvas toolbar. */
export const STAGE_CANVAS_FLOOR = 160

const OPEN_KEY = 'studio.stage.open'
const HEIGHT_KEY = 'studio.stage.height'

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== 'false'
  } catch {
    return true
  }
}

function loadHeight(): number | null {
  try {
    const kept = localStorage.getItem(HEIGHT_KEY)
    const value = Number(kept)
    if (kept !== null && Number.isFinite(value) && value >= STAGE_HEIGHT.min)
      return Math.round(value)
  } catch {}
  return null
}

function keep(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
}

/**
 * The band's height in a view `full` tall: the reader's; else what its content takes whole
 * (`wants`), never under the least; else, unmeasured, its share of the view.
 */
export function stageHeightIn(
  full: number,
  height: number | null,
  wants: number | null = null,
): number {
  if (height !== null) return height
  if (wants !== null) return Math.max(STAGE_HEIGHT.min, Math.ceil(wants))
  return Math.max(STAGE_HEIGHT.least, Math.round(full * STAGE_HEIGHT.share))
}

interface StageState {
  /** whether the band shows what is staged, or the Inspector offers to open it */
  open: boolean
  /** the band's height, as the reader left it; null until they set it */
  height: number | null
  /** whether it stands over the whole canvas and Inspector */
  enlarged: boolean
  /** how many views stage something now; the band shows while one does */
  staged: number
  /** the element what is staged is drawn into, while the band shows */
  slot: HTMLElement | null
  /** how much of the canvas pane's foot the band covers at its height: what framing leaves free */
  cover: number
  /** the height what is staged takes whole, its header included; null until it is measured */
  wants: number | null
  setOpen: (open: boolean) => void
  /** null gives the band back its share of the view */
  setHeight: (height: number | null) => void
  setEnlarged: (enlarged: boolean) => void
  enter: () => void
  leave: () => void
  setSlot: (slot: HTMLElement | null) => void
  setCover: (cover: number) => void
  setWants: (wants: number | null) => void
}

export const useStage = create<StageState>((set) => ({
  open: loadOpen(),
  height: loadHeight(),
  enlarged: false,
  staged: 0,
  slot: null,
  cover: 0,
  wants: null,
  setOpen: (open) => {
    keep(OPEN_KEY, String(open))
    set(open ? { open } : { open, enlarged: false })
  },
  setHeight: (height) => {
    const rounded = height === null ? null : Math.round(Math.max(STAGE_HEIGHT.min, height))
    keep(HEIGHT_KEY, rounded === null ? null : String(rounded))
    set({ height: rounded })
  },
  setEnlarged: (enlarged) => set({ enlarged }),
  enter: () => set((state) => ({ staged: state.staged + 1 })),
  leave: () =>
    set((state) =>
      state.staged > 1 ? { staged: state.staged - 1 } : { staged: 0, enlarged: false },
    ),
  setSlot: (slot) => set((state) => (state.slot === slot ? {} : { slot })),
  setCover: (cover) => set((state) => (state.cover === cover ? {} : { cover })),
  setWants: (wants) => set((state) => (state.wants === wants ? {} : { wants })),
}))
