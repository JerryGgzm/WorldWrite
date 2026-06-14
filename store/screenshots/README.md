# Store graphic assets

Generated, ready to upload to the Chrome Web Store. All product screenshots use
the **real** WorldWrite overlay CSS/markup (mirrored from
`src/content/overlay.ts`) composited over a mock host page, exported at exactly
**1280×800**.

## Files (`out/`)

| File | Size | Use | Suggested caption |
|---|---|---|---|
| `ww-01-translate.png` | 1280×800 | Screenshot #1 (hero) | Write in your language. Be understood anywhere. |
| `ww-02-menu.png` | 1280×800 | Screenshot #2 | One right-click. Every action. |
| `ww-03-explain.png` | 1280×800 | Screenshot #3 | Understand any message instantly. |
| `ww-04-refine.png` | 1280×800 | Screenshot #4 | Refine in one click. See exactly what changed. |
| `ww-marquee-1400x560.png` | 1400×560 | Marquee promo tile (optional) | — |
| `ww-tile-440x280.png` | 440×280 | Small promo tile (optional) | — |

The **store icon (128×128)** is `dist/icons/icon-128.png` (built from
`src/assets/icon-128.png`).

## Regenerating

1. Serve the stage: `cd store/screenshots && python3 -m http.server 8777`
2. Open `http://localhost:8777/scene.html#<scene>` where `<scene>` is one of
   `translate`, `menu`, `explain`, `refine`.
3. Capture exactly 1280×800 (e.g. emulate that viewport, scale factor 1).

The captions, labels, and the two context-menu sections in `scene.html` are kept
in sync with `src/shared/constants.ts`. The target/native languages shown are
set at the top of the inline script (`TARGET = "English"`, `NATIVE = "Chinese"`).

## Source

`source-banner.png` is the original brand banner; the marquee/tile are derived
from it on a matching gradient so there is no visible seam.
