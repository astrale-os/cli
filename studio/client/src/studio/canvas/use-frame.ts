/**
 * The frame for a Scene and Arrangement at one detail: laid out in the worker, cached by
 * key, and held back until ready — the canvas keeps showing the previous frame meanwhile,
 * so a layout in flight never shows a half-placed scene. The reader's pins apply over the
 * cached layout, so placing a box never waits on the worker; pins given for an arrangement
 * still in flight wait for it, and the frame held meanwhile keeps the pins it was shown with.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { Arrangement } from '../scene/arrange'
import type { Scene } from '../scene/types'
import type { Frame } from './frame'
import type { Detail } from './metrics'

import { workerEngine } from './elk'
import { loopLabelSizes } from './labels'
import { layoutArrangement, type Placement } from './layout'
import { measureText } from './measure'
import { pinPlacement, type Pins } from './pins'

const CACHE_SIZE = 24
const cache = new Map<string, Placement>()

function remember(key: string, placement: Placement) {
  cache.delete(key)
  cache.set(key, placement)
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
}

const keyOf = (arrangement: Arrangement, detail: Detail) => `${arrangement.key}#${detail}`

/** A scene and arrangement with their automatic placement. */
interface Laid {
  scene: Scene
  arrangement: Arrangement
  auto: Placement
}

export function useFrame(
  scene: Scene,
  arrangement: Arrangement,
  detail: Detail,
  pins: Pins,
): Frame | undefined {
  const [laid, setLaid] = useState<Laid>()
  const key = keyOf(arrangement, detail)
  const current = laid && keyOf(laid.arrangement, laid.auto.detail) === key

  useEffect(() => {
    if (current) return
    let live = true
    const cached = cache.get(key)
    if (cached) {
      setLaid({ scene, arrangement, auto: cached })
      return
    }
    void layoutArrangement(
      arrangement,
      detail,
      measureText,
      workerEngine,
      loopLabelSizes(scene, arrangement, measureText),
    ).then((auto) => {
      remember(key, auto)
      if (live) setLaid({ scene, arrangement, auto })
    })
    return () => {
      live = false
    }
  }, [arrangement, current, detail, key, scene])

  const kept = useRef(pins)
  if (current) kept.current = pins
  const laidPins = current ? pins : kept.current

  return useMemo(() => {
    if (!laid) return undefined
    const pinned = pinPlacement(laid.auto, laid.arrangement, laidPins)
    return { scene: laid.scene, arrangement: laid.arrangement, ...pinned, laidWith: laidPins }
  }, [laid, laidPins])
}
