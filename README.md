# Polymorph

Chrome extension that turns posts matching rules you wrote in English into
your own images or GIFs. Jev (TypeSafe System One) is the judge. "Show original"
is one click. Nothing is ever deleted — the post is hidden in place and a card
takes its spot.

Personal daily driver. Load unpacked. Not on the Chrome Web Store.

## Load

1. `pnpm install` and `pnpm build`
2. Chrome → `chrome://extensions` → Developer mode → Load unpacked → `dist/`
3. Open Options and follow the three steps on screen

## Set up (the short version)

1. **Add your key** — Options → OpenRouter key → paste → Save key. The key goes
   to `chrome.storage.local` and only the background worker reads it. Use
   **Test connection** to make one real Jev call with fixed synthetic text and
   see the round-trip time.
2. **Enable a rule** — the three example rules ship **OFF on purpose**. Flip
   **Enable rule** next to one you want; the chip turns **Active** and the
   summary reads "1 of 3 rules active". No rule on means no filtering.
3. **Add replacement media (optional)** — Options → Replacement media → add
   PNG, JPEG, WebP, or GIF files from your machine. With media, every matched
   post draws one of your files at random. With an empty library, matched posts
   collapse to a one-line card instead. Nothing is uploaded.
4. **Open a supported site** — X, Reddit, Hacker News, or YouTube. The popup
   shows a readiness line: "Working here — 1 rule active" or the exact reason
   it is paused.

The popup has the master switch and a switch for the current site. The options
page also edits rules, the media library, and the site list. Default allowlist
is X, Reddit, HN, and YouTube (with `www.`/`old.`/`m.` cousins).

## Replacement media

Matched posts become a bounded card (max width 480px, art area at most 120px)
with an accessible caption, a rule label, and a keyboard-focusable **Show
original** button.

- **Your library** — add images or GIFs in Options. PNG, JPEG, WebP, and GIF
  are accepted. SVG, HTML, and anything that is not a real raster/GIF file are
  rejected with a per-file message. Limits: 5 MB per file, 200 files, 100 MB
  total.
- **Random, stable draw** — each post deterministically draws from the ordered
  pile (hash of post text + rule id). The same post keeps the same file across
  re-renders and infinite scroll. A short recency list avoids immediate
  repeats; removing files can change future draws.
- **Empty library** — `Add images or GIFs to replace filtered posts. Without
  images, posts are collapsed.` Every matched post then renders the compact
  collapse card, never placeholder art.
- **GIF fidelity** — animated GIFs play normally. Under
  `prefers-reduced-motion` the first frame is drawn once (frozen), or the post
  is collapsed if a frame cannot be produced; animations never run.
- **Where the bytes live** — originals are stored in IndexedDB in the extension
  origin, never in `chrome.storage`, never base64 in settings, never on a
  server. The content script renders a local `blob:` URL and revokes it when
  the page unloads. Diagnostics record an opaque asset id, never a file name,
  path, or contents.

## Rules

Each rule is a name, an instruction in plain English, and an enable switch.
Examples ship off. A good rule names the exception: "political argument,
except election-mechanics explainers." Every rule draws from the same media
library; there are no per-rule visual categories.

## Diagnostics

Options → Diagnostics (also linked from the popup) shows per-tab counters
(discovered, queued, evaluated, transformed, skipped, errors, restored), the
provider pause state, last activity, and the 100 most recent outcomes: time,
host, rule, asset id, duration, error kind, and character count. Post text is
never stored — only its length; media names and contents are never stored.
**Copy diagnostics** produces redacted text; **Clear** empties the ring.

## Privacy

- One post per Jev request. Author names, HTML, cookies, and page chrome are
  never sent.
- The OpenRouter key stays in extension local storage and only the background
  service worker uses it, only against `openrouter.ai`.
- Your images and GIFs stay on this machine: no upload, no image CDN, no
  tracker, no new service, and never sent to Jev.
- Mail, banks, password managers, and local hosts are on a hard denylist: no
  DOM scrape, no Jev call, no popup override.
- If Jev errors, times out, or is unsure, the post stays visible. After
  provider failures the worker backs off before trying again.

## Develop

```
pnpm test        # pure-module suite: hosts, gate, policy, cache, marking,
                 # media validation/selection/store/service, migration,
                 # reduced motion, diagnostics
pnpm typecheck   # tsc --noEmit
pnpm build       # icons -> typecheck -> pages/worker -> content IIFE
pnpm verify      # checks dist/ is a loadable MV3 package, no bundled media,
                 # and no unexpected external URLs in shipped code
node scripts/qa/run.mjs --dist ./dist --label local [--full]
```

`pnpm build` needs `rsvg-convert` (librsvg) on PATH to render
`assets/icons/polymorph.svg` into 16/32/48/128 PNGs. The build fails closed if
the renderer is missing or a PNG comes out the wrong size.

Source layout:

```
src/background.ts       service worker: key, Jev, cache, backoff, diagnostics,
                        media library -- the only process that touches IndexedDB
src/content.ts          denylist gate, adapters, marking, media pick, card UI
src/card.ts             shadow-DOM replacement card (user image or collapse)
src/marking.ts          state + text-signature marking (US-010)
src/media/              types, magic-byte validation, IndexedDB store,
                        service, base64 transport, selection
src/jev/                client, gate, cache, key, queue, precheck
src/popup/  src/options/  src/ui/
assets/icons/           polymorph.svg source (branding)
scripts/build-icons.mjs, scripts/verify-dist.mjs, scripts/qa/
```