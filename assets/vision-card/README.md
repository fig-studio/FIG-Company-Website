# Vision card

A customer card whose brand mark is drawn as fine vertical lines (WebGL), with a
local brightening under the pointer and machine-vision style detection boxes
(SVG). Plain JS, no dependencies, same as the rest of the site.

Lab page with the tuning panel and replay: `/labs/vision-card` (noindex, unlinked).

**Status: exploration.** The reference video could not be opened when this was
built, so the values come from a written description and are untested against the
reference. Both masks in `masks.js` are unverified (see the header there).

## Use

```html
<link rel="stylesheet" href="/assets/vision-card/vision-card.css">
<div class="vcard vcard--discord" id="c">
  <div class="vcard__head">…logo + name…</div>
  <div class="vcard__foot">
    <p class="vcard__desc">…</p>
    <a class="vcard__cta" href="…">Read the story →</a>
  </div>
</div>
<script src="/assets/vision-card/masks.js"></script>
<script src="/assets/vision-card/vision-card.js"></script>
<script>
  VisionCard.mount(document.getElementById('c'), {
    mask: VisionCardMasks.discord,           // or { src: '/logos/x.svg' } / { path, viewBox }
    theme: { line: '#ffffff', box: '#ff3fd4' },
    params: { /* paste "Copy params as JSON" from the lab here */ },
    seed: 11
  });
</script>
```

The returned card has `setParams(patch)`, `setTheme(patch)` and `destroy()`.
All parameters, with their defaults and units, are in `VisionCard.DEFAULTS` at
the top of `vision-card.js`.

## Behaviour

- Motion runs on simulated seconds (`step(dt)`), not frames. The lab's replay
  plays a fixed pointer path at a fixed dt, so a given T always gives the same frame.
- Rendering pauses off screen and in background tabs.
- On touch devices (`hover: none`) the pattern is static. A tap gives one short
  pulse and two boxes, and scrolling is never blocked.
- With `prefers-reduced-motion` the pattern holds still and no boxes appear.
  The pointer brightening stays.
- Without WebGL a static 2D silhouette is drawn.
- The effect layers have `pointer-events: none`, so links stay clickable.
- `sweep` (a one-time light pass across the card) is off by default, because
  what triggers it in the reference is unconfirmed.

## Checks

```bash
python3 -m http.server 8765 &
node tools/vision-card/check.js /tmp/vision-shots
```
