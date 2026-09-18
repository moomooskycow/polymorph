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
