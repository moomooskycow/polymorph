# Polymorph v2 — audit findings and design rationale

Baseline: `master` @ c704747 (v0.1.0). Candidate: branch `phaedrus/polymorph-v2`.
Method: read the full v1 source; then reproduce in a real browser — the built
MV3 extension loaded into an isolated Chromium profile, fixture pages for the
supported sites mapped to real hostnames, and a deterministic local mock of
the Jev endpoint. See `docs/QA.md` for the harness. Evidence runs:

- baseline: `~/.cache/polymorph-qa/runs/2026-09-19T20-02-47-410Z-baseline2/`
  (report.md, report.json, screenshots/) — 86 checks, 12 failed, 15 soft-failed.
- candidate: recorded in the PR and the kanban handoff.

## Root causes vs hypotheses

| # | Hypothesis | Verdict | Evidence |
|---|------------|---------|----------|
| 1 | The user's setup was incomplete (missing key / no enabled rule) | **Confirmed — affordance failure.** The user ticked rule checkboxes to make filtering work; they did not know the checkboxes enable/disable rules. The checkbox is unlabeled, looks like a bulk-select control, and examples ship disabled with no onboarding. | baseline options screenshot; `enable-rule-flow` scenario passes only when the checkbox is found and saved; vision review of the baseline options page |
| 2 | Infinite scroll / late-inserted posts are not processed | **Partially disproven.** Appended nodes ARE processed by v1's MutationObserver (`appended-posts` passes on baseline). The real dynamic-feed gap is recycled/virtualized nodes. | baseline `appended-posts` pass; `recycled-node` fail |
| 3 | Recycled/virtualized nodes (X/Reddit) are never re-evaluated | **Confirmed.** v1 marks nodes with a permanent `data-polymorph` attribute. A node re-used for new content stays skipped forever; a collapsed node that gets new content keeps a stale bar. | baseline `recycled-node` fail: "recycled left node re-evaluated and collapsed — false" |
| 4 | Turning the engine off leaves posts hidden | **Confirmed.** v1 stops scanning on disable but never restores collapsed posts. | baseline `disable-restores` fail: "bars removed when disabled — 7 bars remain" |
| 5 | Provider failures collapse posts incorrectly | **Disproven.** v1 fails open on 401/429/network/malformed and on gate misses. | baseline `provider-401/429/offline/malformed`, `gate-no-match` pass |
| 6 | No brand, no icons | **Confirmed.** v1 ships no manifest icons and no favicon. | baseline `icons-present` fail: `manifest.icons` `{}` |
| 7 | No diagnostics | **Confirmed.** v1 has no debug surface; counters are a single per-tab collapsed count. | baseline `diagnostics-truthfulness` soft fail |
| 8 | "Collapse" is the only outcome | **Confirmed by design.** v1 bundles 4 static SVGs picked per rule face; no randomization, no mix choice, no animation, no motion policy. | baseline `replacement-library` soft fail: "replacement diversity — 1 distinct" |

## What v2 changes (design rationale)

1. **Readiness-first UI.** The popup answers three questions in order: is it
   working here, how many rules are active, what happened on this tab. The
   options page adds a first-run checklist and an explicit **Enable rule**
   switch with Active/Off status and an "N of M rules active" count. Existing
   rules are never enabled silently.
2. **Transformation, not erasure** ("polymorph, not avada kedavra"). The
   collapsed bar becomes a bounded transformation card: bundled art, an
   accessible caption, and one-click **Show original**. A global replacement
   mix chooses categories (cute / meme / motivation / mixed / collapse-only);
   per-rule overrides remain possible.
3. **Stable randomization.** Selection is a deterministic hash of the post
   text plus rule id, so re-renders keep the same replacement; a small recency
   buffer avoids immediate repeats.
4. **Motion policy.** Animated art is optional; `prefers-reduced-motion`
   yields a static fallback, and the check reacts to runtime changes.
5. **Dynamic-feed correctness.** Signature-based marking re-evaluates nodes
   whose content changed and leaves unchanged nodes alone; disabling the
   engine restores collapsed posts; failures stay fail-open.
6. **Privacy-safe diagnostics.** Counters, bounded recent outcomes (redacted),
   clear/copy actions. No API key, no post text, no claims of health while idle.
7. **Brand.** An original Polymorph mark, PNG icons at 16/32/48/128 generated
   from committed SVG sources, and a favicon for extension pages.

## Media policy

All replacement art is original and bundled: no scraped memes, no hotlinked
CDNs, no media service, and no transmission of filtered text to image
providers. Each asset carries id, category, caption, motion, license, and
author in `assets/replacements/manifest.json`; regeneration steps are in the
library README.

## Honest limitations

- Fixture pages prove the pipeline, not live-site selectors; live coverage in
  this round is one real site (news.ycombinator.com) with a mock provider.
- The popup host row needs a real toolbar gesture (`activeTab`); automated
  runs check it softly.
- The mock provider is deterministic; live Jev variance is out of scope here.
