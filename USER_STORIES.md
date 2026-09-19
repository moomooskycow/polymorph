# Stories

<!-- Root artifact: what users must be able to do. One file, ids never
reused, criteria a check can fail on. skill://user-stories guides edits. -->

## Capability: English rules over a feed

## US-001 Paste a key and write English rules

Statement: When I load Polymorph, I want to paste an OpenRouter key and write
named rules in plain English, so Jev only judges posts against rules I turned on.

Criteria:
1. WHEN the options page is saved with an OpenRouter key, THE SYSTEM SHALL store
   that key only in extension local storage and SHALL never inject it into a page.
2. WHEN a rule is disabled, THE SYSTEM SHALL omit it from Jev questions.
3. WHEN no rule is enabled, THE SYSTEM SHALL leave the page unchanged and SHALL
   not call Jev.
4. THE SYSTEM SHALL ship three example rules (political argument except
   explainers, rage bait, reply-guy) in the disabled state.

No-gos: no Astra, no local-only keyword matcher as a substitute for Jev, no
synced copy of the API key.

Evidence: `src/policy.test.ts`, `src/defaults.ts`

## US-002 Collapse a matching post and restore it

Statement: When I scroll an allowlisted site, I want a post that matches an
enabled rule collapsed to a one-line bar naming that rule, so I can restore
that post with one click.

Criteria:
1. WHEN Jev returns a match that passes the gate, THE SYSTEM SHALL replace the
   post with a one-line bar that names the matching rule and SHALL keep a restore
   control on that bar.
2. WHEN I click restore, THE SYSTEM SHALL show the original post again in that
   place and SHALL not re-collapse it until a reload.
3. THE SYSTEM SHALL classify one post per Jev request (no multi-post state).
4. WHEN a post's visible text is under 40 characters, THE SYSTEM SHALL skip it.

No-gos: no hard-delete, no classifying the whole page as one blob.

Evidence: `src/collapse.test.ts`, `src/jev/client.ts`

## US-003 Optional kitten or meme face on a collapsed bar

Statement: When I set a rule's face to kitten or meme, I want the collapsed bar
to show a bundled image, so the hole is not blank.

Criteria:
1. WHERE a matching rule's face is `kitten` or `meme`, THE SYSTEM SHALL draw the
   bar with a bundled SVG from the extension package, not a live CDN.
2. WHERE a matching rule's face is `collapse`, THE SYSTEM SHALL draw the bar
   with the rule name and restore control only.
3. THE SYSTEM SHALL NOT add third-party meme image files to the repository.

No-gos: no Sploot, no placekitten, no scraped copyrighted memes.

Evidence: `src/faces.test.ts`, `assets/`

## US-004 Hard denylist never leaves the machine

Statement: When I visit mail, a bank, a password manager, or a local/Hermes
surface, I want no page text sent off this machine, so a feed filter cannot
read those pages.

Criteria:
1. WHEN the host is on the hard denylist, THE SYSTEM SHALL not read page text
   and SHALL not call Jev, even if the allowlist would otherwise include it.
2. THE SYSTEM SHALL treat at least these as denylisted: Gmail, Outlook,
   Fastmail, Proton Mail, common US banks and brokers, 1Password, Bitwarden,
   LastPass, Dashlane, `localhost`, `127.0.0.1`.
3. THE SYSTEM SHALL not expose a popup control that removes a denylisted host.

No-gos: no "unlock this bank from the popup."

Evidence: `src/hosts.test.ts`, `src/hosts.ts`

## US-005 Allowlist starts small; current host can be added

Statement: When I am on a site that is not denylisted, I want the engine off
until that host is allowlisted, so the first install does not send every tab
to Jev.

Criteria:
1. WHEN the extension is first installed, THE SYSTEM SHALL allowlist only
   `x.com`, `twitter.com`, `reddit.com`, `news.ycombinator.com`, and
   `youtube.com` (plus their `www.` / `old.` / `m.` cousins).
2. WHEN I toggle the current host on in the popup and that host is not
   denylisted, THE SYSTEM SHALL add it to the allowlist and start classifying
   there.
3. WHEN I toggle the current host off, THE SYSTEM SHALL stop classifying there
   and SHALL not call Jev on later posts from that host.
4. THE SYSTEM SHALL ship a master enable switch in the popup. WHEN it is off,
   THE SYSTEM SHALL not call Jev on any host.

No-gos: no on-everywhere default, no Chrome Web Store listing in this story.

Evidence: `src/hosts.test.ts`, `src/popup/`

## US-006 Fail open when Jev is down or unsure

Statement: When Jev errors, times out, or is below the gate, I want the post
left visible, so a classifier outage never blanks a page.

Criteria:
1. IF the Jev request fails, times out, or returns a non-OK body, THE SYSTEM
   SHALL leave the post visible and SHALL not retry in a tight loop.
2. IF the match probability is at or below 0.85 or the choice confidence is
   below 0.70, THE SYSTEM SHALL leave the post visible.
3. WHEN the same post text is seen again in this session, THE SYSTEM SHALL
   reuse the cached decision and SHALL not call Jev again for that hash.

No-gos: no fail-closed hiding, no dumping a whole feed into one Jev state.

Evidence: `src/jev/gate.test.ts`, `src/jev/cache.ts`

## US-007 Rule enablement is discoverable

Statement: When I open options for the first time, I want to see why nothing is
filtered and turn a rule on with an explicit switch, so I do not conclude the
extension is broken.

Criteria:
1. WHEN no key is saved or no rule is active, THE SYSTEM SHALL show a first-run
   block with three numbered steps: add the key, enable a rule, open a
   supported site.
2. WHEN a rule is displayed, THE SYSTEM SHALL show an "Enable rule" switch with
   visible text and an Active/Off chip, not a bare checkbox.
3. THE SYSTEM SHALL show "N of M rules active" on options and a matching
   one-line readiness banner in the popup.
4. WHEN rules are saved, THE SYSTEM SHALL not enable any rule the operator did
   not switch on.

No-gos: no auto-enabling the examples, no hidden enable control.

Evidence: `src/options/main.ts`, `src/popup/main.ts`, `src/settings.test.ts`

## US-008 Transform a matching post into a replacement card

Statement: When a post matches a rule, I want it turned into something welcome
with one click back, so filtering feels like transformation, not erasure.

Criteria:
1. WHEN a match passes the gate, THE SYSTEM SHALL replace the post with a
   bounded card (max-width 480px, art area at most 120px) that names the rule,
   shows an accessible caption, and keeps a keyboard-focusable "Show original"
   control with a visible focus ring.
2. WHERE the resolved mix is `collapse`, THE SYSTEM SHALL render a one-line
   card with no art and the same restore control.
3. WHERE a rule's face is a category, THE SYSTEM SHALL use that mix for that
   rule only; `inherit` SHALL use the global mix.
4. WHEN the mix changes while a page is open, THE SYSTEM SHALL redraw existing
   cards without another Jev call.
5. WHEN "Show original" is activated, THE SYSTEM SHALL restore the post and
   SHALL not transform that same content again until reload.
6. THE SYSTEM SHALL bundle 12-16 original assets with at least four per
   category, each with caption, author, license, and created date in
   `assets/replacements/manifest.json`.

No-gos: no deletion, no remote art, no scraped copyrighted memes, no invented
quote attributions.

Evidence: `src/card.test.ts`, `src/replacements/library.test.ts`,
`src/replacements/selection.test.ts`

## US-009 Stable, non-repeating replacement selection with reduced motion

Statement: When a post re-renders, I want the same replacement to stay, and
when I prefer reduced motion I want still art, so the feed does not flicker or
move.

Criteria:
1. WHEN the same normalized text and rule are evaluated again, THE SYSTEM SHALL
   choose the identical asset.
2. THE SYSTEM SHALL avoid the last 8 picks on a page when an alternative
   exists.
3. WHEN `prefers-reduced-motion: reduce` matches, THE SYSTEM SHALL substitute
   an animated asset's declared static fallback and freeze animations on the
   card.
4. WHEN the media query changes at runtime, THE SYSTEM SHALL update mounted
   cards without a reload.

No-gos: no random per-render picks, no animation without a static path.

Evidence: `src/replacements/selection.test.ts`, `src/card.test.ts`

## US-010 Dynamic feeds stay correct

Statement: When a feed recycles DOM nodes or loads more on scroll, I want only
new or changed posts judged and stale cards cleared, so infinite scroll does
not break.

Criteria:
1. THE SYSTEM SHALL mark posts with a state plus a signature of normalized
   visible text; identical text SHALL skip re-evaluation.
2. WHEN a transformed node's text changes, THE SYSTEM SHALL remove the card,
   restore the post, and re-evaluate the new content.
3. THE SYSTEM SHALL scan changed subtrees incrementally on mutation instead of
   querying the whole document per mutation.
4. WHEN settings disable or pause the engine, THE SYSTEM SHALL stop scanning
   and restore every transformed post (fail-open).
5. WHEN the provider fails with 429, 5xx, timeout, or network error, THE SYSTEM
   SHALL pause new calls with growing backoff and re-check deferred posts after
   the pause.
6. THE SYSTEM SHALL cap in-flight Jev calls at 4 and SHALL not re-queue its own
   cards in a mutation loop.

No-gos: no permanent mark that ignores changed content, no full-document scan
per mutation.

Evidence: `src/marking.test.ts`, `src/backoff.test.ts`,
`src/adapters/adapters.test.ts`

## US-011 Privacy-safe diagnostics

Statement: When something looks off, I want counts and outcomes I can copy, so
I can tell whether the extension is working without leaking page text.

Criteria:
1. THE SYSTEM SHALL report per-tab counters
   discovered/queued/evaluated/transformed/skipped/errors/restored and keep a
   ring buffer capped at 100 outcomes in session storage.
2. THE SYSTEM SHALL store outcomes with host, rule, asset, duration, error
   kind, and character count only; it SHALL NOT store post text or the key.
3. WHEN there has been no activity, THE SYSTEM SHALL say so and SHALL not
   imply that quiet means healthy.
4. THE SYSTEM SHALL offer Clear and Copy diagnostics; the copied text SHALL
   contain no post text and no key.
5. THE SYSTEM SHALL be reachable from both the popup and the options page.

No-gos: no post text in the ring, no key in diagnostics.

Evidence: `src/diagnostics.test.ts`, `src/background.ts`, `src/options/main.ts`

## US-012 First-run setup and connection test

Statement: When I open options after installing, I want a short path to a
working setup and a way to verify my key, so I know the engine is wired up.

Criteria:
1. WHEN no key is saved or no rule is enabled, THE SYSTEM SHALL show the
   three-step setup block; once both are true, THE SYSTEM SHALL hide it.
2. WHEN "Test connection" is pressed, THE SYSTEM SHALL make exactly one
   bounded Jev call with fixed synthetic text and report ok or fail with
   elapsed milliseconds.
3. THE SYSTEM SHALL not print, log, or store the key outside
   `chrome.storage.local`; options SHALL read only a saved/missing boolean.
4. WHEN no key is saved, "Test connection" SHALL report `no_key` without a
   network call.

No-gos: no key echo, no automatic repeated test calls.

Evidence: `src/options/main.ts`, `src/background.ts`, `src/jev/key.ts`
