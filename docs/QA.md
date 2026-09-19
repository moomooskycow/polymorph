# Polymorph browser QA

Repeatable browser QA for the built MV3 extension. Future agents run this
without asking the user to test anything by hand.

The suite loads the BUILT extension into an isolated persistent Chromium
profile and exercises the real pipeline: extension storage, the service
worker, content scripts, popup/options pages, and DOM effects on real feed
markup. It never touches the principal's browser, profile, cookies, or the
loaded extension in `~/Development/moomooskycow/polymorph/dist`.

## Prerequisites

- Node 26+ and pnpm.
- Chromium. Resolution order: `POLYMORPH_CHROMIUM` env, `/usr/sbin/chromium`,
  then the Playwright browser cache (`~/.cache/ms-playwright/chromium-*`).
- `playwright-core` resolvable. On this machine it lives under
  `/home/phaedrus/.hermes/hermes-agent/node_modules`. Set
  `PLAYWRIGHT_PATH=<dir containing playwright-core>` if that changes.
- `openssl` (self-signed cert for fixture hosts, generated on first run).

## Build and run

```sh
pnpm install
pnpm build && pnpm verify        # typecheck + build + artifact validation
pnpm test                        # pure-module unit suite
node scripts/qa/run.mjs --dist ./dist --label local
```

Useful flags:

- `--dist <path>` — built extension to load (default `./dist`).
- `--label <name>` — tag for the evidence directory.
- `--full` — include the slow provider-timeout scenario (waits 24s).
- `--live` — add the bounded live-site smoke (real news.ycombinator.com DOM,
  mock provider, separate browser context without host mapping).
- `--scenario <name>` — run one scenario only.
- `--headed` — run with a visible window (debugging only).
- `--out <dir>` — evidence directory override.

Evidence defaults to
`~/.cache/polymorph-qa/runs/<timestamp>-<label>/` with `report.json`,
`report.md`, and `screenshots/`. The isolated profile lives under
`~/.cache/polymorph-qa/profiles/`. Both are safe to delete.

## How it works (and why it is trustworthy)

- **Real extension.** Chromium loads `--load-extension=<dist>`. The harness
  discovers the extension id from the registered service worker.
- **Fixture hosts.** Synthetic pages for x.com, reddit.com,
  news.ycombinator.com, youtube.com, gmail.com, and fixture.test are served
  locally over HTTPS and mapped to 127.0.0.1 with `--host-resolver-rules`.
  The real adapters fire because the hostname is real; the DOM is a labelled
  fixture, not a live site.
- **Mock provider.** `openrouter.ai` is mapped to the local fixture server,
  which answers `POST /api/alpha/decisions` deterministically. The harness
  sets the storage key `jevEndpointOverride` (https only) so the extension
  talks to the mock. Production behavior is unchanged when that key is unset.
  The mock is clearly labelled: fixture-provider pass is NOT live Jev proof.
- **Storage and settings.** The harness writes real `chrome.storage.local`
  values (key, rules, allowlist) through a real extension page.
- **User media fixtures.** `scripts/qa/lib/fixtures.mjs` generates a tiny
  valid PNG set, an animated GIF, a corrupt PNG, and an SVG at run time. Media
  scenarios import them through the real options file input and prove local
  IndexedDB persistence across an extension restart (same profile, relaunched
  context).

## Scenarios (default set)

1. `extension-loads` — worker registers, MV3 manifest.
2. `options-first-run` — options renders; guidance/switch/count affordances.
3. `icons-present` — manifest icons at 16/32/48/128 with real PNG dimensions.
4. `fixture-collapse-basic` — posts collapse on load; bar content; page stays
   interactive; provider body carries no session markers.
5. `restore-one-click` — Show original restores the post, removes the bar,
   and does not re-evaluate.
6. `appended-posts` — infinite-scroll style appended nodes collapse.
7. `recycled-node` — virtualized/reused nodes: a left post with new matching
   content collapses; a collapsed node with new non-matching content is
   restored (fail-open).
8. `disable-restores` — turning the engine off restores collapsed posts.
9. `no-key` / `no-rules` — nothing is sent, nothing collapses.
10. `enable-rule-flow` — enabling a rule through the options UI makes
    filtering work (the user-confirmed diagnosis).
11. `restricted-site` — denylisted host: no calls, no collapse.
12. `provider-401` / `provider-malformed` / `gate-no-match` — fail-open paths.
13. `media-empty-collapse` — with an empty library, matched posts render the
    compact collapse card (no `<img>`), keep Show original, and options shows
    the exact empty-state copy.
14. `media-add-and-render` — add one real PNG through the options file input;
    matched posts render it from a local `blob:` URL with bounded height and
    Show original; the extension is then restarted on the same profile and the
    library and rendering persist.
15. `media-multiple-stable` — three assets: cards draw from more than one, and
    the same post keeps the same asset across a same-text rerender.
16. `media-remove-and-reject` — removing the final asset returns to the empty
    state; a corrupt PNG and an SVG are rejected with visible feedback and
    never enter the library or render in a card.
17. `media-no-external-requests` — while a user image renders, there are no
    external or fixture-hosted asset requests, and card images are local
    object/data URLs only.
18. `reduced-motion` — with an animated GIF in the library, no animating GIF
    renders under prefers-reduced-motion; the card must be frozen or collapsed,
    and no CSS animations run.
19. `popup-states` — the REAL action popup is opened with
    `chrome.action.openPopup()` and reached through a CDP attach on the
    browser's debug port (`--remote-debugging-port=9223`); it renders and its
    readiness text is asserted. Because activeTab is only granted by a real
    toolbar click (not available under automation), the host row is checked on
    a second render where a real tab with a readable URL (openrouter.ai, the
    standing host permission) is the active tab: the popup must visibly show
    the host, the "Working here" readiness line, the site toggle must write the
    allowlist both ways (storage readback), and the Options control must reach
    the options page.
20. `options-configured` — key saved state, enable switch, replacement-media
    section, diagnostics section.
21. `diagnostics-truthfulness` — counters visible; key, post text, and media
    file names absent.
22. `no-external-requests` — no requests to unexpected origins.
23. `live-hn-smoke` (with `--live`) — runs BEFORE the failure cluster so the
    bounded provider backoff cannot starve it.
24. `provider-timeout` (with `--full`).
25. `provider-429-final` / `provider-offline-final` — run LAST, each in its own
    fresh context (bounded backoff is worker state; a shared context would let
    the first failure starve the next). The 429 scenario asserts the pause is
    visible in diagnostics afterwards.
26. `backoff-recovery` (with `--full`) — fresh context: 429 storm pauses the
    provider, then, with NO resets, the harness waits for the pause to expire
    (diagnostics `paused` flips to false) and proves a fresh page transforms
    posts again. This is the production recovery path.

Fresh-context scenarios open the fixture page, then reload it before waiting
for content. This guards against a cold-start race where the extension's
content-script registry is not ready when the first navigation commits.

## Manual / live Jev smoke (bounded, optional)

Fixture runs never call the live provider. To smoke the real provider:

1. Obtain an authorized OpenRouter key (do not paste it into chat or files).
2. Send one synthetic, non-sensitive request:

```sh
curl -sS https://openrouter.ai/api/alpha/decisions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"typesafe/jev-1.13","state":"{\"site\":\"qa\",\"text\":\"A synthetic QA post about railway timetables.\"}","questions":{"qa":{"type":"choice","instructions":"Decide whether the post is rage bait.","criteria":{"match":"The post is rage bait.","no_match":"The post is calm and technical."}}}}'
```

Expected: HTTP 200 with an `answers` object keyed by `qa`. Record the result
in the run report. If no authorized key is available, say so — never
fabricate a live pass.

Live smoke result (2026-09-19, run `candidate2`): both directions verified —
calm synthetic text returned `no_match` (confidence 1.0); rage-bait synthetic
text returned `match` (probability 1.0, confidence 1.0), gate verdict
collapse. Raw responses: `live-jev-smoke-calm.json`,
`live-jev-smoke-ragebait.json` next to that run's report.

## Honest limitations

- Fixture pages are synthetic; they prove the pipeline, not live-site
  selectors. Live selector coverage currently includes one real site
  (news.ycombinator.com smoke). Reddit/X/YouTube live DOMs are NOT verified.
- The popup's host display depends on the `activeTab` grant, which comes
  from a real toolbar click. Automated runs cannot click the toolbar, so the
  popup host row is checked softly; everything else in the popup is real.
- The mock provider is deterministic; live Jev variance is not covered.
- Bundled replacement-art checks are gone with the bundled library; user-media
  checks now run through the real file input and IndexedDB (add, render,
  restart persistence, multiple/stable, remove-to-empty, corrupt/SVG rejection,
  no external requests, reduced-motion GIF).
- The GIF freeze path is asserted as "never animated under reduced motion";
  whether it freezes or collapses depends on the browser's canvas availability
  in that context.
- Missing-asset fallback and theme coverage are covered by unit tests and
  screenshots, not by browser assertions for every case.

## Teardown

Delete `~/.cache/polymorph-qa/` (profiles, certs, runs). No system state is
modified; the principal's browser is never started or restarted.
