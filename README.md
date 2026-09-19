# Polymorph

Chrome extension that collapses posts matching rules you wrote in English.
Jev (TypeSafe System One) is the judge. Restore is one click. A rule can
put a bundled kitten or meme on the collapsed bar instead of a blank hole.

Personal daily driver. Load unpacked. Not on the Chrome Web Store.

## Load

1. `pnpm install` and `pnpm build`
2. Chrome → `chrome://extensions` → Developer mode → Load unpacked → `dist/`
3. Options → paste an OpenRouter key that can call `typesafe/jev-1.13`
4. Turn on at least one rule
5. Open X, Reddit, HN, or YouTube

The popup has the master switch and a toggle for the current host. The
options page writes the key and never reads it back; it also edits rules and
the allowlist. Default allowlist is those four sites. Mail, banks, password
managers, and localhost never send page text off this machine.

## Verify

`pnpm test` runs the pure-module suite (hosts, policy, gate, cache, collapse
markup, faces, adapters). `pnpm verify` checks that `dist/` really contains a
loadable MV3 extension: manifest, worker, content script, both pages, and the
bundled faces.

## Rules

Each rule is a name, an English instruction, on/off, and a face
(`collapse` / `kitten` / `meme`). Examples ship off. A good rule names
the exception: "political argument, except election-mechanics explainers."
Faces are original SVGs bundled in the extension; nothing is fetched from an
image CDN and no scraped memes are included.

## Privacy

Matching runs one post at a time. Post text goes to OpenRouter / TypeSafe.
The API key never enters the page. If Jev is down, posts stay visible.
