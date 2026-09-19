# Polymorph

Chrome extension that turns posts matching rules you wrote in English into
welcome replacements. Jev (TypeSafe System One) is the judge. "Show original"
is one click. Nothing is ever deleted — the post is hidden in place and a
card takes its spot.

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
3. **Open a supported site** — X, Reddit, Hacker News, or YouTube. The popup
   shows a readiness line: "Working here — 1 rule active" or the exact reason
   it is paused.

The popup has the master switch and a switch for the current site. The options
page also edits rules, the replacement mix, and the site list. Default
allowlist is X, Reddit, HN, and YouTube (with `www.`/`old.`/`m.` cousins).

## Replacement mix

A matched post becomes a card with bounded art (max width 480px, art area at
most 120px), an accessible caption, and a keyboard-focusable **Show original**
button. Choose the global mix in Options, or give a single rule its own
replacement:

- **Mixed** (default) — cute, meme, and motivation art
- **Cute only** / **Meme only** / **Motivation only**
- **Collapse only** — a one-line card with no art, closest to v1 behavior

Each rule can override the global mix (`Use global mix` keeps it). Selection is
deterministic per post: the same text and rule always get the same asset, so
re-renders do not flicker. A short recency list avoids immediate repeats, and
`prefers-reduced-motion` swaps animated art for its static fallback.

## Rules

Each rule is a name, an instruction in plain English, an enable switch, and a
replacement choice. Examples ship off. A good rule names the exception:
"political argument, except election-mechanics explainers."

Replacement art is a bundled set of 14 original vector illustrations (SVG)
drawn for Polymorph: cute animals, comic expressions, and short original
encouragement lines. It is not a photo or GIF library — every item is
hand-authored vector art. Two items are animated (SMIL) and fall back to a
static twin under `prefers-reduced-motion`. No image CDN, no scraped memes, no
hotlinks, no new services. License/author metadata lives in
`assets/replacements/manifest.json`; regeneration steps live in
`assets/replacements/README.md`.

## Diagnostics

Options → Diagnostics (also linked from the popup) shows per-tab counters
(discovered, queued, evaluated, transformed, skipped, errors, restored), the
provider pause state, last activity, and the 100 most recent outcomes: time,
host, rule, asset, duration, error kind, and character count. Post text is
never stored — only its length. **Copy diagnostics** produces redacted text;
**Clear** empties the ring.

## Privacy

- One post per Jev request. Author names, HTML, cookies, and page chrome are
  never sent.
- The OpenRouter key stays in extension local storage and only the background
  service worker uses it, only against `openrouter.ai`.
- Mail, banks, password managers, and local hosts are on a hard denylist: no
  DOM scrape, no Jev call, no popup override.
- If Jev errors, times out, or is unsure, the post stays visible. After
  provider failures the worker backs off before trying again.
- Replacement art is bundled; the content script inlines SVG text. Nothing is
  fetched from an image host.

## Develop

```
pnpm test        # pure-module suite: hosts, gate, policy, cache, marking,
                 # selection, migration, reduced motion, diagnostics
pnpm typecheck   # tsc --noEmit
pnpm build       # icons -> typecheck -> pages/worker -> content IIFE
pnpm verify      # checks dist/ is a loadable MV3 package
```

`pnpm build` needs `rsvg-convert` (librsvg) on PATH to render
`assets/icons/polymorph.svg` into 16/32/48/128 PNGs. The build fails closed if
the renderer is missing or a PNG comes out the wrong size.

Source layout:

```
src/background.ts       service worker: key, Jev, cache, backoff, diagnostics
src/content.ts          denylist gate, adapters, marking, card UI, counters
src/card.ts             shadow-DOM replacement card
src/marking.ts          state + text-signature marking (US-010)
src/replacements/       bundled library, selection, SVG parsing
src/jev/                client, gate, cache, key, queue, precheck
src/popup/  src/options/  src/ui/
assets/replacements/    library SVGs + manifest.json + README
assets/icons/           polymorph.svg source
scripts/                build-icons.mjs, verify-dist.mjs
```