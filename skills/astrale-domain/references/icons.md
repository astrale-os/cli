# Domain icons

A Domain declares one icon set, drawn by hand at three sizes. The Shell picks the drawing that fits the
size it renders, so a 16 px rail entry and a 512 px store tile each get artwork made for them instead
of one image scaled up or down.

## Declaring the set

The icon belongs to the Schema, like its `name`: declare it on `defineSchema` with `domainIcon`, and
it enters the Schema revision. Each size is inline SVG text wrapped in `classIcon.svg(...)` (or a
`classIcon.lucide(...)` glyph); there is no file path.

```ts
// schema/schema.ts
import { classIcon, defineSchema, domainIcon } from '@astrale-os/sdk/schema'

import { largeSvg, mediumSvg, smallDarkSvg, smallSvg } from './icon-art'

export const schema = defineSchema('work.example', {
  name: 'Work',
  icon: domainIcon({
    small: { svg: classIcon.svg(smallSvg), dark: classIcon.svg(smallDarkSvg) },
    medium: classIcon.svg(mediumSvg),
    large: classIcon.svg(largeSvg),
  }),
  // ...
})
```

- Each size is either a `ClassIcon` or `{ svg, dark? }`, where `svg` is the light drawing and `dark`
  an optional drawing for dark themes, under the same limits. Without `dark`, the Shell shows the light
  drawing on both themes.
- Every size is optional, but at least one is required. Declare `small`: the SDK linter warns when it
  is missing, because a large drawing scaled down to 16 px rarely stays legible.
- `defineDomain({ icon })` is deprecated: it only feeds the legacy `manifest.logo`. Move the icon to
  `defineSchema`. When both exist, the kernel refuses a release whose `logo` differs from `small`.
- The SDK runs SVGO at build time (2 decimal places). Keep the source drawings readable.
- The build also emits `small` as the legacy `manifest.logo`, so older kernels still show it.
- Do not attach the icon after `defineSchema` (for example on the frontend): the frontend must share
  the same Schema value.
- The icon is presentation only: changing it makes a new Schema revision but does not change its
  compatibility digest. The kernel projects it on the `Domain` node as `iconSmall`, `iconMedium`,
  and `iconLarge`.

`domainIcon` is new: check the installed SDK's exports for its import path before trusting the one
above. The admission rules live in the SDK's `class-icon-svg.ts`.

## Sizes

| Size     | Shown at        | Artboard (`viewBox`) | Limit per SVG (UTF-8 bytes) | Used for                        |
| -------- | --------------- | -------------------- | --------------------------- | ------------------------------- |
| `small`  | 16 to 24 px     | `0 0 24 24`          | 8 KiB (8192)                | rail, tabs, favicon, lists      |
| `medium` | 28 to 96 px     | `0 0 64 64`          | 32 KiB (32768)              | sidebar header, cards, pickers  |
| `large`  | 128 px and more | `0 0 512 512`        | 256 KiB (262144)            | store page, install screen      |

The Shell picks `small` up to 24 px, `medium` up to 96 px, and `large` above. When that size is
missing, it uses the next larger size scaled down, else the next smaller one scaled up, else the
Domain's initials.

## Style

Aim for the look of macOS Dock app icons: a full square tile with one clear, recognizable symbol,
soft gradients, gentle light from above, and a hint of depth. Keep it calm and polished; no
photographs, no busy scenes, no text.

The Shell supplies what the operating system supplies on the Dock: the rounded corner shape and any
outer shadow. Do not draw either into the artwork.

Each size is a separate drawing, not an export of the same file at another size:

- `small`: one bold silhouette, closer to a menu bar glyph than a Dock icon: strokes of at least 2
  units on the 24 grid, no text, at most two colors. Snap edges to whole units so the glyph stays
  sharp at 1x.
- `medium`: the same symbol with a little more detail, such as a second shape or a soft gradient.
- `large`: the full Dock-style illustration. Gradients, highlights, and depth belong here.

## Layout

- **Background edge to edge.** The background fills the whole artboard as a square. Do not draw
  rounded corners or a mask: the Shell applies its own corner shape, which differs by surface.
- **Safe zone 80 %.** Keep the symbol inside the centered square that covers 80 % of the artboard
  (19.2 on `small`, 51.2 on `medium`, 409.6 on `large`). Anything outside it may be clipped by the
  Shell's mask.
- **Layers (optional).** Group the drawing in two top-level `<g>` elements, background first:

  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <g data-layer="background"><rect width="24" height="24" fill="#4F46E5"/></g>
    <g data-layer="foreground"><path d="..." fill="#FFFFFF"/></g>
  </svg>
  ```

  The Shell shows the full tile, the foreground alone on surfaces that bring their own plate, or the
  foreground as a single-color mask tinted with the surrounding text color. A drawing without these
  layers is treated as a full tile.
- **Dark variant.** Provide `dark` when the light drawing loses contrast on a dark surface, typically
  a dark symbol or a near-white background. Keep the same shapes and change only colors.

## Accepted SVG

The SDK at build time and the kernel at install apply the same rules, and refuse a drawing that
breaks them:

- One complete root `<svg>` element with at least one visible graphic element, within its size's
  limit.
- `url(...)` only in the exact form `url(#id)`, with `id` matching `[A-Za-z][A-Za-z0-9_-]*`: internal
  gradients, filters, clip paths, and masks, such as `fill="url(#glow)"`.
- No `style` element and no `style` attribute: use presentation attributes such as `fill`, `stroke`,
  `opacity`, and `stroke-width`.
- No `script`, `foreignObject`, `iframe`, `embed`, `object`, `image`, `use`, `animate`, `set`, or
  `discard` element; no `DOCTYPE` or `ENTITY`; no `on*` attribute; no `href` or `xlink:href`; no
  `javascript:`.

Because `use` and `href` are refused, repeat a shape instead of referencing it. Because `image` is
refused, an icon that only works as a photo does not fit this format.

The Shell always renders the icon as an image, or as a CSS mask for the single-color mode. It never
inserts the SVG into the page, so a drawing cannot run code or load anything.

## Checklist

1. Draw `small`, `medium`, and `large` on their artboards, background edge to edge, symbol in the
   80 % safe zone, layers `background` and `foreground`.
2. Add `dark` where contrast needs it.
3. Look at `small` at 16 px and 24 px at 1x; simplify until the silhouette reads.
4. Build the Domain; fix the SDK's size and SVG refusals and its missing-`small` warning before
   installing.
