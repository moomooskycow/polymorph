# Implementation contract

Chrome MV3 extension. Jev judges each post against the operator's English
rules and collapses matches. `USER_STORIES.md` is the root contract. Cite a
story id in every behavioral change.

## Locked decisions (do not reopen)

- Public repo, unpacked load, Chrome only. No Firefox, no Web Store.
- Jev model `typesafe/jev-1.13` via OpenRouter
  `POST https://openrouter.ai/api/alpha/decisions`. Never Astra.
- API key in `chrome.storage.local` only. Background service worker is the
  only process that reads it or calls OpenRouter.
- One post per Jev request. All enabled rules are parallel `choice` questions
  (`match` / `no_match`) on that one post. Never put two posts in one `state`.
- Gate: `choice === match` AND `probabilities.match > 0.85` AND
  `confidence >= 0.70`. Otherwise leave the post.
- Fail open on network/API errors.
- Default allowlist: X, Reddit, HN, YouTube. Engine can run on any other
  host the operator adds. Hard denylist is not overridable from the popup.
- Match action: collapse to a one-line bar with the rule name and restore.
  Per-rule face may be `collapse` | `kitten` | `meme`. Faces are bundled SVGs.
- Example rules ship disabled.
- Threshold defaults: 0.85 / 0.70.

## Shape

Vanilla TypeScript, ES modules, Vite for the extension build, Vitest for
pure functions. No React, no Husky, no i18n, no Sploot, no live image CDN.

```
src/background.ts      service worker: Jev, cache, storage
src/content.ts         host check, adapters, collapse UI (shadow DOM)
src/popup/             master switch, current-host toggle, collapsed count
src/options/           key, rules editor, allowlist, read-only denylist
src/hosts.ts           allowlist + hard denylist
src/policy.ts          rules → Jev questions, gate
src/jev/               client, cache, gate
src/adapters/          x, reddit, hn, youtube, generic
assets/faces/          bundled SVG kittens and meme cards
```

Content script matches `<all_urls>` but MUST check the denylist before any
`innerText` read. Denylisted pages: no DOM scrape, no Jev.

Adapters own "what is a post." Generic adapter: `article`, `[role="article"]`,
skip `nav, header, footer, aside, form, [contenteditable], button`. Skip
nodes under 40 characters of visible text.

## Jev call

State is JSON text, capped at 24,000 characters:

```
{ "site": "x.com", "text": "<visible innerText of one post>" }
```

No author ids, no HTML, no cookies. `HTTP-Referer` / `X-Title`: Polymorph.

## Verification

`pnpm test` must cover hosts, gate, policy, cache, collapse markup, faces.
Do not claim X/Reddit DOM behavior verified without a fixture. Load unpacked
from `dist/` as documented in README.

## v2 addendum (2026-09-19, US-007..US-012)

The locked decisions above still hold. These notes record where v2 changes
mechanics, not intent.

- **US-002 action, restated.** A gate-passing match is now a replacement card
  (US-008). The old one-line bar is the `collapse` mix inside that card:
  same restore control, no art. Deletion was never allowed and still is not.
- **Marking** is `data-polymorph-state` + `data-polymorph-sig` (FNV-1a of
  normalized text). Same text skips re-evaluation; a transformed node whose
  text changes is restored and re-judged. The v1 `data-polymorph` attribute is
  cleared on sight.
- **Scans** are incremental: MutationObserver records flush per changed
  subtree via `closestPost`/`collectPostsIn`; full scans happen only on start,
  re-enable, deferred retry, and host change. `characterData` is observed so
  in-place text edits count as recycled content.
- **Settings changes** re-check state; pause/disable/master-off restore every
  transformed post and clear marks so re-enabling re-evaluates. A mix change
  redraws cards without another Jev call.
- **Backoff**: retryable Jev failures (429, 5xx, timeout, network) pause new
  calls for 5s, doubling to 60s, reset on success. Posts in the pause window
  are marked `deferred` and re-checked once when the pause ends.
- **Replacement mix**: global `replacementMix` plus per-rule face; stored v1
  `kitten` normalizes to `cute` and missing faces to `inherit`. Assets live in
  `assets/replacements/` with `manifest.json`; raw SVG text is inlined, never
  fetched. Recomputation of state for selection is pure (`selection.ts`).
- **Diagnostics**: per-tab counters reported by content, aggregated in the
  worker; a 100-entry ring in `chrome.storage.session` holds structured
  outcomes only (no text, no key). `formatDiagnostics` is the redacted copy.
- **Icons**: `assets/icons/polymorph.svg` renders to `public/icons/icon-*.png`
  via `scripts/build-icons.mjs` (rsvg-convert, fail-closed), wired into
  `pnpm build`; manifest icons and page favicons use those PNGs.
- No new permissions, no new runtime dependencies, key storage and the hard
  denylist are unchanged.

## v3 addendum (2026-09-19, US-013/US-014): user media replaces bundled art

The locked decisions still hold: key handling, denylist, one-post Jev state,
gate, fail-open, no new permissions. These notes record the replacement-media
pivot.

- **Removed**: `assets/replacements/**` (14 SVGs + manifest + README),
  `src/replacements/**`, the mix/category/face types and UI, and the
  `web_accessible_resources` entry that existed only for bundled art. Branding
  (`assets/icons/polymorph.svg`, generated PNGs, manifest icons, favicons) is
  unchanged. `verify-dist.mjs` now fails if `dist/assets/replacements` exists.
- **Storage**: `src/media/store.ts` — IndexedDB `polymorph-media` / object
  store `assets`, one record per file `{id, kind, mime, size, addedAt, width,
  height, thumb, blob}`. `chrome.storage.local` keeps only lightweight
  settings; no blobs or base64 there. `MemoryMediaStore` shares a backing Map
  so unit tests can model an extension restart.
- **Validation**: `src/media/validate.ts` sniffs PNG/JPEG/GIF(87a|89a)/WebP
  magic bytes and rejects everything else (SVG/HTML included). Caps: 5 MB per
  file, 200 files, 100 MB total. The worker additionally decodes with
  `createImageBitmap` (corrupt/truncated rejection) and derives dimensions plus
  a small WebP/PNG thumbnail via `OffscreenCanvas` (`src/media/browser.ts`).
  IndexedDB `QuotaExceededError` maps to a clear `quota_exceeded` message.
- **Transport**: extension messaging JSON-serializes, so bytes cross contexts
  as base64 (`src/media/bytes.ts`), bounded by the per-file cap. The content
  script turns them into a local `blob:` URL (LRU-cached per page, revoked on
  eviction/pagehide). No media is ever written into page storage, settings, or
  a Jev request.
- **Selection**: `src/media/selection.ts` orders the pile by `addedAt` + id and
  draws `stableIndex(hash(signature + "\u0000" + ruleId))`, skipping the last 8
  picks when possible. The background owns the draw; the content script sends
  its recent list and caches the returned asset by id.
- **Card**: `src/card.ts` renders a bounded `<img>` (max 480px wide, art area
  ≤120px) or the compact collapse card when the draw is empty. Captions are
  generic ("Your image/GIF replaces this post"), never file names. GIFs under
  `prefers-reduced-motion` are drawn to a first-frame PNG via canvas; if that
  fails the post collapses rather than animating.
- **Library changes while a page is open**: the worker broadcasts
  `mediaChanged` after add/remove/clear; content re-draws existing cards (and
  collapses them if the library became empty). `settingsChanged` keeps its v2
  behavior.
- **Migration**: stored rules keep working; legacy `face`/`kitten`/
  `replacementMix` fields are dropped by `sanitizeRules`/`mergeSettings`
  without changing any `enabled` flag.
- **Diagnostics**: transformed events keep an opaque `assetId`; file names,
  paths, and bytes are never recorded. QA additionally asserts no fixture file
  names appear anywhere in the diagnostics text.
