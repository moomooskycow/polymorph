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

Default allowlist is those four. The popup can add the current host.
Mail, banks, password managers, and localhost never send page text off
this machine.

## Rules

Each rule is a name, an English instruction, on/off, and a face
(`collapse` / `kitten` / `meme`). Examples ship off. A good rule names
the exception: "political argument, except election-mechanics explainers."

## Privacy

Matching runs one post at a time. Post text goes to OpenRouter / TypeSafe.
The API key never enters the page. If Jev is down, posts stay visible.
