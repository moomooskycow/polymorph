# Polymorph replacement library

Every file here is original artwork authored for Polymorph and released with the
extension. No scraped memes, no third-party fan art, no hotlinked images. The
canonical metadata for each item lives in `manifest.json` (id, file, category,
caption, motion, fallback, license, author, created).

Rules for adding or regenerating an item:

1. Author or draw a new SVG. Keep it original. Do not trace or copy a
   copyrighted character, and do not use an emoji glyph as the artwork.
2. No external references: no `href`, no `<image>`, no `url(...)`, no remote
   fonts. The content script inlines the SVG into a shadow root, so it must be
   self-contained.
3. `viewBox` should be near `0 0 160 120`. The card reserves a 104 px art area;
   wide or tall art scales down and stays legible at ~200 px wide.
4. Animation is optional. Animated items embed a `<style>` block whose class
   names start with `pm-`, and they declare a `staticFallback` pointing at a
   static item with the same visual. Reduced-motion users get the fallback at
   pick time, and the card also freezes animations via `data-reduced-motion`.
5. `caption` is the accessible description and the visible caption. Keep it
   short, concrete, and free of claims about real people. Motivational items
   use original copy with NO invented attributions.
6. Add the item to `manifest.json` and import its raw SVG in
   `src/replacements/library.ts` (the build inlines the text; the file is also
   copied to `dist/assets/replacements/`).

Verification:

- `pnpm test` — checks manifest shape, category counts, licenses, captions,
  animated fallbacks, and that SVGs contain no remote references.
- `pnpm build && pnpm verify` — checks the assets reach `dist/`.