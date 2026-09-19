import { HARD_DENYLIST, normalizeHost } from '../hosts';
import { formatDiagnostics, lastActivityAt, type DiagnosticsSnapshot } from '../diagnostics';
import { assetsByCategory, type ReplacementAsset } from '../replacements/library';
import { svgElement } from '../replacements/svg';
import { loadSettings, sanitizeRules, saveSettings } from '../settings';
import { el, section, switchControl } from '../ui/dom';
import type { Face, ReplacementMix, Rule } from '../types';

function requireApp(): HTMLElement {
  const node = document.getElementById('app');
  if (node === null) throw new Error('options: #app missing');
  return node;
}

const app = requireApp();

async function send<T>(message: unknown): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return null;
  }
}

const MIXES: { value: ReplacementMix; label: string; hint: string }[] = [
  { value: 'mixed', label: 'Mixed', hint: 'Cute, meme, and motivation together. Default.' },
  { value: 'cute', label: 'Cute only', hint: 'Kittens, pups, ducks, and otters.' },
  { value: 'meme', label: 'Meme only', hint: 'Original comic faces, shrugs, and tiny panic.' },
  { value: 'motivation', label: 'Motivation only', hint: 'Short original lines of encouragement.' },
  {
    value: 'collapse',
    label: 'Collapse only',
    hint: 'No art: a one-line card with a Show original button.',
  },
];

const FACES: { value: Face; label: string }[] = [
  { value: 'inherit', label: 'Use global mix' },
  { value: 'collapse', label: 'Collapse only' },
  { value: 'cute', label: 'Cute' },
  { value: 'meme', label: 'Meme' },
  { value: 'motivation', label: 'Motivation' },
];

function statusLine(className = 'status'): HTMLParagraphElement {
  return el('p', className);
}

/** US-007: first-run guidance, hidden once a key and a rule are set. */
function setupSection(done: boolean): HTMLElement | null {
  if (done) return null;
  const node = section('Get set up — 3 steps');
  const list = el('ol', 'steps');
  const first = el('li');
  first.append(el('strong', undefined, 'Paste your OpenRouter key'), el('span', undefined, ' below.'));
  const second = el('li');
  second.append(
    el('strong', undefined, 'Turn on at least one rule'),
    el('span', undefined, ' — the example rules ship OFF on purpose. Flip Enable rule.'),
  );
  const third = el('li');
  third.append(
    el('strong', undefined, 'Open a supported site'),
    el('span', undefined, ' — x.com, reddit.com, news.ycombinator.com, or youtube.com.'),
  );
  list.append(first, second, third);
  node.append(list);
  return node;
}

/* ------------------------------------------------------------------ key */

function keySection(hasKey: boolean): HTMLElement {
  const node = section('OpenRouter key');
  node.append(
    el(
      'p',
      'muted',
      'Stored in extension local storage only. The options page never reads it back, and no page ever sees it.',
    ),
  );
  const input = el('input');
  input.type = 'password';
  input.placeholder = hasKey ? 'Replace key…' : 'sk-or-…';
  input.autocomplete = 'off';

  const status = statusLine();
  status.textContent = hasKey ? 'Key saved.' : 'No key saved. Nothing is sent anywhere.';

  const save = el('button', 'primary', 'Save key');
  save.addEventListener('click', async () => {
    if (input.value.trim().length === 0) {
      status.textContent = 'Nothing to save.';
      return;
    }
    await send({ type: 'setKey', key: input.value });
    input.value = '';
    status.textContent = 'Key saved. Now enable a rule below.';
  });

  const clear = el('button', undefined, 'Clear key');
  clear.addEventListener('click', async () => {
    await send({ type: 'clearKey' });
    input.value = '';
    status.textContent = 'Key cleared.';
  });

  // US-005 / US-007: one bounded real call with fixed synthetic text.
  const test = el('button', undefined, 'Test connection');
  test.addEventListener('click', async () => {
    test.disabled = true;
    status.className = 'status';
    status.textContent = 'Testing connection…';
    const result = await send<{ ok: boolean; ms: number; errorKind?: string; status?: number }>({
      type: 'testKey',
    });
    test.disabled = false;
    if (result === null) {
      status.className = 'status status--bad';
      status.textContent = 'Test failed: no response from the extension.';
      return;
    }
    if (result.ok) {
      status.className = 'status status--ok';
      status.textContent = `Connected — Jev answered in ${result.ms} ms.`;
    } else {
      status.className = 'status status--bad';
      const detail = result.errorKind ?? 'error';
      const http = result.status === undefined ? '' : ` (HTTP ${result.status})`;
      status.textContent = `Test failed: ${detail}${http} after ${result.ms} ms.`;
    }
  });

  const toolbar = el('div', 'toolbar');
  toolbar.append(save, clear, test);
  node.append(input, toolbar, status);
  return node;
}

/* ------------------------------------------------------------------ mix */

function previewThumb(asset: ReplacementAsset): HTMLElement {
  const thumb = el('div', 'preview-thumb');
  thumb.setAttribute('data-reduced-motion', String(window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  const svg = svgElement(asset.svg);
  if (svg !== null) thumb.append(svg);
  thumb.title = asset.caption;
  return thumb;
}

function collapsePreview(): HTMLElement {
  const preview = el('div', 'preview-thumb preview-thumb--plain');
  preview.append(el('span', undefined, 'Hidden by rule “Rage bait”'));
  preview.append(el('span', 'preview-restore', 'Show original'));
  return preview;
}

function mixSection(current: ReplacementMix): HTMLElement {
  const node = section('Replacement mix');
  node.append(
    el('p', 'muted', 'What a matched post becomes. Individual rules can override this.'),
  );
  const group = el('div', 'mixes');
  for (const mix of MIXES) {
    const label = el('label', 'mix');
    const input = el('input');
    input.type = 'radio';
    input.name = 'replacement-mix';
    input.value = mix.value;
    input.checked = current === mix.value;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      void saveSettings({ replacementMix: mix.value });
    });
    const body = el('span', 'mix-body');
    body.append(el('strong', undefined, mix.label), el('span', 'muted', mix.hint));
    const preview = el('span', 'previews');
    if (mix.value === 'collapse') {
      preview.append(collapsePreview());
    } else {
      const categories =
        mix.value === 'mixed' ? (['cute', 'meme', 'motivation'] as const) : ([mix.value] as const);
      for (const category of categories) {
        for (const asset of assetsByCategory(category).slice(0, 2)) {
          preview.append(previewThumb(asset));
        }
      }
    }
    label.append(input, body, preview);
    group.append(label);
  }
  node.append(group, el('p', 'muted', 'Changes save immediately.'));
  return node;
}

/* ---------------------------------------------------------------- rules */

function ruleEditor(
  rule: Rule | undefined,
  handlers: { onToggle: (article: HTMLElement, enabled: boolean) => void; onDirty: () => void },
): HTMLElement {
  const article = el('article', 'rule');
  if (rule !== undefined) article.dataset.ruleId = rule.id;

  const head = el('div', 'rule-head');
  const chip = el('span', 'chip');
  const sw = switchControl({
    label: 'Enable rule',
    checked: rule?.enabled ?? false,
    onChange: (enabled) => {
      updateChip();
      handlers.onToggle(article, enabled);
    },
  });
  const name = el('input');
  name.type = 'text';
  name.placeholder = 'Rule name (e.g. Rage bait)';
  name.value = rule?.name ?? '';
  name.addEventListener('input', () => handlers.onDirty());
  const remove = el('button', 'danger-button', 'Remove');
  remove.addEventListener('click', () => {
    article.remove();
    handlers.onDirty();
  });
  head.append(sw, chip, name, remove);

  const grid = el('div', 'rule-grid');
  const instructionsLabel = el('label');
  instructionsLabel.append(el('span', 'field-label', 'Instruction sent to Jev'));
  const instructions = el('textarea');
  instructions.placeholder = 'Plain English. Name the exception, e.g. “Political argument, except explainers.”';
  instructions.value = rule?.instructions ?? '';
  instructions.addEventListener('input', () => handlers.onDirty());
  instructionsLabel.append(instructions);

  const faceLabel = el('label');
  faceLabel.append(el('span', 'field-label', 'Replacement for this rule'));
  const face = el('select');
  for (const option of FACES) {
    const item = el('option');
    item.value = option.value;
    item.textContent = option.label;
    face.append(item);
  }
  face.value = rule?.face ?? 'inherit';
  face.addEventListener('change', () => handlers.onDirty());
  faceLabel.append(face);

  grid.append(instructionsLabel, faceLabel);
  article.append(head, grid);

  const updateChip = (): void => {
    const enabled = article.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked ?? false;
    chip.textContent = enabled ? 'Active' : 'Off';
    chip.className = `chip ${enabled ? 'chip--on' : 'chip--off'}`;
  };
  updateChip();
  return article;
}

function slugify(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'rule';
  let id = base;
  let counter = 2;
  while (taken.has(id)) {
    id = `${base.slice(0, 45)}-${counter}`;
    counter += 1;
  }
  return id;
}

function readRule(article: HTMLElement, taken: Set<string>): Rule | null {
  const name = article.querySelector<HTMLInputElement>('input[type="text"]')?.value.trim() ?? '';
  const instructions = article.querySelector<HTMLTextAreaElement>('textarea')?.value.trim() ?? '';
  if (name === '' && instructions === '') return null;
  const enabled =
    article.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked ?? false;
  const faceValue = article.querySelector<HTMLSelectElement>('select')?.value;
  const face = FACES.some((option) => option.value === faceValue)
    ? (faceValue as Face)
    : 'inherit';
  const id = article.dataset.ruleId ?? slugify(name, taken);
  taken.add(id);
  article.dataset.ruleId = id;
  return { id, name: name || id, instructions, enabled, face };
}

function collectRules(list: HTMLElement): Rule[] {
  const taken = new Set<string>();
  const rules: Rule[] = [];
  for (const article of list.querySelectorAll<HTMLElement>('.rule')) {
    const rule = readRule(article, taken);
    if (rule !== null) rules.push(rule);
  }
  return rules;
}

function rulesSection(initial: readonly Rule[]): HTMLElement {
  const node = section('Rules');
  node.append(
    el(
      'p',
      'muted',
      'Each rule is a name plus an instruction in plain English. Switch one on to have Jev judge posts against it.',
    ),
  );
  const summary = el('p', 'summary');
  const list = el('div');
  const updateSummary = (): void => {
    const total = list.querySelectorAll('.rule').length;
    const active = list.querySelectorAll('input[type="checkbox"]:checked').length;
    summary.textContent = `${active} of ${total} rules active`;
    summary.className = active > 0 ? 'summary summary--on' : 'summary summary--off';
  };

  const status = statusLine();
  // The last-saved rules. Toggling a switch must never commit other fields:
  // it merges only the enable flag onto this baseline. Text edits and
  // removals stay pending until Save rules, exactly as the copy says.
  let savedRules: Rule[] = initial.map((rule) => ({ ...rule }));
  const setOk = (message: string): void => {
    status.className = 'status status--ok';
    status.textContent = message;
  };
  const applyToggle = async (article: HTMLElement, enabled: boolean): Promise<void> => {
    const id = article.dataset.ruleId;
    if (id !== undefined && savedRules.some((rule) => rule.id === id)) {
      savedRules = savedRules.map((rule) => (rule.id === id ? { ...rule, enabled } : rule));
      await saveSettings({ rules: savedRules });
      updateSummary();
      setOk(
        enabled
          ? 'Rule switched on — applied immediately (text edits still need Save rules).'
          : 'Rule switched off — applied immediately (text edits still need Save rules).',
      );
      return;
    }
    const fresh = readRule(article, new Set(savedRules.map((rule) => rule.id)));
    if (fresh === null) {
      status.className = 'status';
      status.textContent = 'Give the new rule a name or an instruction first.';
      return;
    }
    savedRules = [...savedRules, { ...fresh, enabled }];
    await saveSettings({ rules: savedRules });
    updateSummary();
    setOk(enabled ? 'New rule switched on — applied immediately.' : 'New rule switched off — applied immediately.');
  };
  const handlers = {
    // The Enable rule switch applies the moment it flips. No hidden save
    // step: the user's complaint was exactly this ambiguity.
    onToggle: (article: HTMLElement, enabled: boolean): void => {
      void applyToggle(article, enabled);
    },
    onDirty: (): void => {
      status.className = 'status';
      status.textContent = 'Unsaved edits — press Save rules to apply them.';
    },
  };
  for (const rule of initial) list.append(ruleEditor(rule, handlers));

  const add = el('button', undefined, 'Add rule');
  add.addEventListener('click', () => {
    list.append(ruleEditor(undefined, handlers));
    updateSummary();
    handlers.onDirty();
  });
  const save = el('button', 'primary', 'Save rules');
  save.addEventListener('click', async () => {
    const cleaned = sanitizeRules(collectRules(list));
    await saveSettings({ rules: cleaned });
    savedRules = cleaned.map((rule) => ({ ...rule }));
    updateSummary();
    setOk(`Saved ${cleaned.length} rule${cleaned.length === 1 ? '' : 's'}.`);
  });

  const toolbar = el('div', 'toolbar');
  toolbar.append(add, save);
  node.append(summary, list, toolbar, status);
  node.append(
    el('p', 'muted', 'Enable switches apply immediately. Name, instruction, and removal edits need Save rules.'),
  );
  updateSummary();
  return node;
}

/* ------------------------------------------------------------ allowlist */

function allowlistSection(initial: readonly string[]): HTMLElement {
  const node = section('Sites Polymorph runs on');
  node.append(
    el(
      'p',
      'muted',
      'One host per line. Nothing runs anywhere else. The popup can also turn the current site on or off.',
    ),
  );
  const textarea = el('textarea');
  textarea.value = initial.join('\n');
  const status = statusLine();
  const save = el('button', 'primary', 'Save sites');
  save.addEventListener('click', async () => {
    const hosts = [
      ...new Set(textarea.value.split(/\s+/).map(normalizeHost).filter((host) => host !== '')),
    ];
    await saveSettings({ allowlist: hosts });
    status.className = 'status status--ok';
    status.textContent = `Saved ${hosts.length} host${hosts.length === 1 ? '' : 's'}.`;
  });
  const toolbar = el('div', 'toolbar');
  toolbar.append(save);
  node.append(textarea, toolbar, status);
  return node;
}

/* -------------------------------------------------------- privacy/deny */

function privacySection(): HTMLElement {
  const node = section('Privacy');
  const list = el('ul', 'plain-list');
  for (const line of [
    'One post is sent per Jev request. Author names, HTML, cookies, and page chrome are never sent.',
    'The OpenRouter key stays in extension storage and goes only to openrouter.ai from the background worker.',
    'If Jev is down or unsure, the post stays visible. Nothing is ever deleted.',
    'Replacement art is bundled with the extension. No image CDN, no trackers, no new services.',
  ]) {
    list.append(el('li', undefined, line));
  }
  node.append(list);
  return node;
}

function denylistSection(): HTMLElement {
  const node = section('Never runs on these (hard denylist)');
  node.append(el('p', 'muted', 'Mail, banks, password managers, and local surfaces are never scraped or sent.'));
  const list = el('ul', 'denylist');
  for (const host of HARD_DENYLIST) list.append(el('li', undefined, host));
  node.append(list);
  return node;
}

/* --------------------------------------------------------- diagnostics */

function ageText(at: number | null, now: number): string {
  if (at === null) return 'no activity yet';
  const ms = Math.max(0, now - at);
  if (ms < 1_000) return 'just now';
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function diagnosticsSection(): HTMLElement {
  const node = section('Diagnostics', 'diagnostics');
  node.append(
    el(
      'p',
      'muted',
      'Counters cover this browser session and survive closing a tab. Post text is never stored here — only its character count.',
    ),
  );

  const status = el('p', 'status');
  const grid = el('div', 'stats-grid');
  const rulesLine = el('p', 'muted');
  const recent = el('div', 'recent');
  let latest: DiagnosticsSnapshot | null = null;

  const renderSnapshot = (snapshot: DiagnosticsSnapshot): void => {
    const last = lastActivityAt(snapshot.recent);
    status.className = snapshot.paused ? 'status status--bad' : 'status';
    status.textContent = [
      `v${snapshot.version}`,
      snapshot.paused ? `provider paused (${Math.ceil(snapshot.pausedForMs / 1000)}s left)` : 'provider ready',
      `last activity: ${ageText(last, snapshot.generatedAt)}`,
    ].join(' · ');

    const counters = { ...snapshot.totals };
    grid.replaceChildren();
    for (const key of ['discovered', 'queued', 'evaluated', 'transformed', 'skipped', 'errors', 'restored'] as const) {
      const cell = el('div', 'stat');
      cell.append(el('span', 'stat-value', String(counters[key])), el('span', 'stat-label', key));
      grid.append(cell);
    }

    rulesLine.textContent = `Active rules: ${snapshot.activeRules.join(', ') || '(none)'}`;

    recent.replaceChildren();
    const newestFirst = [...snapshot.recent].reverse().slice(0, 20);
    if (newestFirst.length === 0) {
      recent.append(el('p', 'muted', 'No outcomes recorded yet in this browser session.'));
    }
    for (const event of newestFirst) {
      const line = el('div', 'recent-row');
      const time = new Date(event.at).toLocaleTimeString();
      const detail = [
        event.outcome,
        event.ruleId === undefined ? null : `rule=${event.ruleId}`,
        event.assetId === undefined ? null : `asset=${event.assetId}`,
        event.durationMs === undefined ? null : `${event.durationMs}ms`,
        event.errorKind === undefined ? null : `error=${event.errorKind}`,
        event.textLength === undefined ? null : `chars=${event.textLength}`,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ');
      line.append(el('span', 'recent-time', time), el('span', undefined, `${event.host} — ${detail}`));
      recent.append(line);
    }
  };

  const load = async (): Promise<void> => {
    const snapshot = await send<DiagnosticsSnapshot>({ type: 'getDiagnostics' });
    if (snapshot === null) {
      status.textContent = 'Diagnostics unavailable (background not responding).';
      return;
    }
    latest = snapshot;
    renderSnapshot(snapshot);
  };

  const refresh = el('button', undefined, 'Refresh');
  refresh.addEventListener('click', () => void load());

  const copy = el('button', undefined, 'Copy diagnostics');
  copy.addEventListener('click', async () => {
    if (latest === null) return;
    try {
      await navigator.clipboard.writeText(formatDiagnostics(latest));
      status.className = 'status status--ok';
      status.textContent = 'Diagnostics copied (redacted: no post text, no key).';
    } catch {
      status.className = 'status status--bad';
      status.textContent = 'Copy failed. Use Refresh and select the text manually.';
    }
  });

  const clear = el('button', 'danger-button', 'Clear');
  clear.addEventListener('click', async () => {
    await send({ type: 'clearDiagnostics' });
    await load();
  });

  const toolbar = el('div', 'toolbar');
  toolbar.append(refresh, copy, clear);
  node.append(status, grid, rulesLine, toolbar, recent);

  void load();
  const timer = window.setInterval(() => void load(), 3_000);
  window.addEventListener('pagehide', () => window.clearInterval(timer));
  return node;
}

/* ------------------------------------------------------------------ init */

async function render(): Promise<void> {
  const settings = await loadSettings();
  const keyState = (await send<{ hasKey: boolean }>({ type: 'hasKey' })) ?? { hasKey: false };
  const enabled = settings.rules.filter((rule) => rule.enabled).length;

  app.replaceChildren();
  app.append(el('h1', undefined, 'Polymorph options'));
  const setup = setupSection(keyState.hasKey && enabled > 0);
  if (setup !== null) app.append(setup);
  app.append(keySection(keyState.hasKey));
  app.append(mixSection(settings.replacementMix));
  app.append(rulesSection(settings.rules));
  app.append(allowlistSection(settings.allowlist));
  app.append(privacySection());
  app.append(denylistSection());
  app.append(diagnosticsSection());
  if (window.location.hash === '#diagnostics') {
    document.getElementById('diagnostics')?.scrollIntoView();
  }
}

void render();