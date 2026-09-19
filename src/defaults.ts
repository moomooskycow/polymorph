import type { Rule } from './types';

export const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = 'typesafe/jev-1.13';
export const JEV_TIMEOUT_MS = 20_000;
export const MAX_STATE_CHARS = 24_000;
export const MAX_INFLIGHT_JEV_CALLS = 4;

/** Gate defaults. Both are contract values; do not tune here without a story. */
export const GATE_PROBABILITY = 0.85;
export const GATE_CONFIDENCE = 0.7;

/** Posts with less visible text than this are never sent to Jev. */
export const MIN_POST_CHARS = 40;

const BASE_ALLOWLIST = [
  'x.com',
  'twitter.com',
  'reddit.com',
  'news.ycombinator.com',
  'youtube.com',
] as const;

/**
 * First-install allowlist: the five sites plus their `www.`, `old.` and `m.`
 * cousins, spelled out so the popup toggle can add and remove exact hosts.
 * US-005.
 */
export const DEFAULT_ALLOWLIST: readonly string[] = BASE_ALLOWLIST.flatMap((host) => [
  host,
  `www.${host}`,
  `old.${host}`,
  `m.${host}`,
]);

/** US-001: three examples ship disabled. */
export const EXAMPLE_RULES: readonly Rule[] = [
  {
    id: 'political-argument-explainers',
    name: 'Political argument',
    instructions:
      'The post is arguing politics or picking a partisan fight. Match insults, dunks, and tribal point-scoring. Do not match neutral explainers of election mechanics, how a policy works, or how government processes function.',
    enabled: false,
    face: 'collapse',
  },
  {
    id: 'rage-bait',
    name: 'Rage bait',
    instructions:
      'The post is engineered to provoke outrage rather than inform: baiting, inflammatory framing, or an "everyone is angry about this" hook. Do not match good-faith criticism or reporting that merely describes something upsetting.',
    enabled: false,
    face: 'kitten',
  },
  {
    id: 'reply-guy',
    name: 'Reply-guy',
    instructions:
      'The post is an unsolicited correction or nitpick aimed at another person ("well, actually"), where the point is to be right rather than to help. Do not match genuine questions, teaching, or adding missing context in good faith.',
    enabled: false,
    face: 'meme',
  },
];