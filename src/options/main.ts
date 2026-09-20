import { HARD_DENYLIST, normalizeHost } from '../hosts';
import { formatDiagnostics, lastActivityAt, type DiagnosticsSnapshot } from '../diagnostics';
import { bytesToBase64 } from '../media/bytes';
import { emptyUsage, MEDIA_EMPTY_COPY, type MediaAssetMeta, type MediaUsage } from '../media/types';
import { loadSettings, sanitizeRules, saveSettings } from '../settings';
import { el, section, switchControl } from '../ui/dom';
import type { Rule } from '../types';

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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

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

/* -------------------------------------------------------- replacement media */

interface MediaListReply {
  ok: boolean;
  assets?: MediaAssetMeta[];
  usage?: MediaUsage;
}

interface MediaAddReply {
  ok: boolean;
  message?: string;
  usage?: MediaUsage;
}

interface MediaRemoveReply {
  ok: boolean;
  removed?: boolean;
  usage?: MediaUsage;
}

function mediaSection(): HTMLElement {
  const node = section('Replacement media', 'media');
  node.append(
    el(
      'p',
      'muted',
      'Matched posts show one of your images or GIFs. Local files only — nothing is uploaded, and media is never sent to Jev.',
    ),
  );

  const usageLine = el('p', 'media-usage');
  const empty = el('p', 'muted media-empty', MEDIA_EMPTY_COPY);
  const statusBox = el('div', 'media-status');
  const grid = el('div', 'media-grid');

  const input = el('input');
  input.type = 'file';
  input.id = 'media-input';
  input.multiple = true;
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.hidden = true;

  const addButton = el('button', 'primary', 'Add images or GIFs');
  addButton.addEventListener('click', () => input.click());

  const writeStatus = (message: string, bad = false): void => {
    statusBox.append(el('p', bad ? 'status status--bad' : 'status status--ok', message));
    while (statusBox.children.length > 6) statusBox.firstElementChild?.remove();
  };

  let usage: MediaUsage = emptyUsage();
  const renderUsage = (next: MediaUsage): void => {
    usage = next;
    usageLine.textContent = `${next.count} image${next.count === 1 ? '' : 's'} · ${formatBytes(next.totalBytes)} of ${formatBytes(next.maxTotalBytes)}`;
    empty.hidden = next.count > 0;
  };

  const mediaItem = (asset: MediaAssetMeta): HTMLElement => {
    const figure = el('figure', 'media-item');
    figure.dataset.mediaId = asset.id;
    const thumb = el('div', 'media-thumb');
    if (asset.thumb !== null) {
      const image = el('img');
      image.src = asset.thumb;
      image.alt = '';
      thumb.append(image);
    } else {
      thumb.append(el('span', 'muted', 'no preview'));
    }
    const meta = el('figcaption', 'media-meta');
    meta.append(el('span', undefined, `${asset.kind.toUpperCase()} · ${formatBytes(asset.size)}`));
    const remove = el('button', 'danger-button media-remove', 'Remove');
    remove.addEventListener('click', async () => {
      const reply = await send<MediaRemoveReply>({ type: 'media:remove', id: asset.id });
      if (reply !== null && reply.ok) {
        writeStatus(`Removed one ${asset.kind.toUpperCase()} file.`);
        await renderList();
      } else {
        writeStatus('Could not remove that item.', true);
      }
    });
    figure.append(thumb, meta, remove);
    return figure;
  };

  const renderList = async (): Promise<void> => {
    const reply = await send<MediaListReply>({ type: 'media:list' });
    if (reply === null || reply.ok !== true || reply.assets === undefined || reply.usage === undefined) {
      renderUsage(emptyUsage());
      grid.replaceChildren();
      writeStatus('The media library is unavailable in this browser session.', true);
      return;
    }
    renderUsage(reply.usage);
    grid.replaceChildren();
    for (const asset of reply.assets) grid.append(mediaItem(asset));
  };

  input.addEventListener('change', async () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length === 0) return;
    for (const file of files) {
      if (file.size === 0) {
        writeStatus(`${file.name}: the file is empty.`, true);
        continue;
      }
      if (file.size > usage.maxFileBytes) {
        writeStatus(
          `${file.name}: too large; the limit is ${formatBytes(usage.maxFileBytes)} per file.`,
          true,
        );
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        writeStatus(`${file.name}: the file could not be read.`, true);
        continue;
      }
      const reply = await send<MediaAddReply>({
        type: 'media:add',
        mime: file.type || 'application/octet-stream',
        base64: bytesToBase64(bytes),
      });
      if (reply === null) {
        writeStatus(`${file.name}: no response from the extension.`, true);
        continue;
      }
      if (reply.ok) {
        writeStatus(`${file.name}: added.`);
      } else {
        writeStatus(`${file.name}: ${reply.message ?? 'rejected.'}`, true);
      }
    }
    await renderList();
  });

  const toolbar = el('div', 'toolbar');
  toolbar.append(addButton);

  node.append(input, toolbar, usageLine, empty, statusBox, grid);
  void renderList();
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
  grid.append(instructionsLabel);
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
  const id = article.dataset.ruleId ?? slugify(name, taken);
  taken.add(id);
  article.dataset.ruleId = id;
  return { id, name: name || id, instructions, enabled };
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
    'Your replacement images and GIFs stay on this machine. They are never uploaded and never sent to Jev.',
    'If Jev is down or unsure, the post stays visible. Nothing is ever deleted.',
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
  app.append(mediaSection());
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