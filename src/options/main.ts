import { HARD_DENYLIST, normalizeHost } from '../hosts';
import { loadSettings, sanitizeRules, saveSettings } from '../settings';
import type { Face, Rule } from '../types';

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

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

function keySection(hasKey: boolean): HTMLElement {
  const section = el('section');
  section.append(el('h2', undefined, 'OpenRouter key'));
  section.append(
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

  const status = el('p', 'status', hasKey ? 'Key saved.' : 'No key saved. Nothing is sent anywhere.');
  const save = el('button', 'primary', 'Save key');
  save.addEventListener('click', async () => {
    if (input.value.trim().length === 0) {
      status.textContent = 'Nothing to save.';
      return;
    }
    await send({ type: 'setKey', key: input.value });
    input.value = '';
    status.textContent = 'Key saved.';
  });
  const clear = el('button', undefined, 'Clear key');
  clear.addEventListener('click', async () => {
    await send({ type: 'clearKey' });
    input.value = '';
    status.textContent = 'Key cleared.';
  });

  const toolbar = el('div', 'toolbar');
  toolbar.append(save, clear);
  section.append(input, toolbar, status);
  return section;
}

function ruleEditor(rule?: Rule): HTMLElement {
  const article = el('article', 'rule');
  if (rule !== undefined) article.dataset.ruleId = rule.id;

  const head = el('div', 'rule-head');
  const enabled = el('input');
  enabled.type = 'checkbox';
  enabled.checked = rule?.enabled ?? false;
  enabled.setAttribute('aria-label', 'Rule enabled');
  const name = el('input');
  name.type = 'text';
  name.placeholder = 'Rule name';
  name.value = rule?.name ?? '';
  const remove = el('button', undefined, 'Remove');
  remove.addEventListener('click', () => article.remove());
  head.append(enabled, name, remove);

  const grid = el('div', 'rule-grid');

  const instructionsLabel = el('label');
  instructionsLabel.append(el('span', 'field-label', 'Instruction'));
  const instructions = el('textarea');
  instructions.placeholder = 'Plain English. Name the exception.';
  instructions.value = rule?.instructions ?? '';
  instructionsLabel.append(instructions);

  const faceLabel = el('label');
  faceLabel.append(el('span', 'field-label', 'Face'));
  const face = el('select');
  for (const option of ['collapse', 'kitten', 'meme'] as const) {
    const item = el('option');
    item.value = option;
    item.textContent = option;
    face.append(item);
  }
  face.value = rule?.face ?? 'collapse';
  faceLabel.append(face);

  grid.append(instructionsLabel, faceLabel);
  article.append(head, grid);
  return article;
}

function collectRules(list: HTMLElement): Rule[] {
  const taken = new Set<string>();
  const rules: Rule[] = [];
  for (const article of list.querySelectorAll<HTMLElement>('.rule')) {
    const name = article.querySelector<HTMLInputElement>('input[type="text"]')?.value.trim() ?? '';
    const instructions = article.querySelector<HTMLTextAreaElement>('textarea')?.value.trim() ?? '';
    if (name === '' && instructions === '') continue;
    const enabled = article.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked ?? false;
    const faceValue = article.querySelector<HTMLSelectElement>('select')?.value;
    const face: Face = faceValue === 'kitten' || faceValue === 'meme' ? faceValue : 'collapse';
    const id = article.dataset.ruleId ?? slugify(name, taken);
    taken.add(id);
    rules.push({ id, name: name || id, instructions, enabled, face });
  }
  return rules;
}

function rulesSection(initial: readonly Rule[]): HTMLElement {
  const section = el('section');
  section.append(el('h2', undefined, 'Rules'));
  section.append(
    el('p', 'muted', 'One enabled rule becomes one Jev question. Examples ship off.'),
  );
  const list = el('div');
  for (const rule of initial) list.append(ruleEditor(rule));
  const status = el('p', 'status');
  const add = el('button', undefined, 'Add rule');
  add.addEventListener('click', () => list.append(ruleEditor()));
  const save = el('button', 'primary', 'Save rules');
  save.addEventListener('click', async () => {
    const cleaned = sanitizeRules(collectRules(list));
    await saveSettings({ rules: cleaned });
    status.textContent = `Saved ${cleaned.length} rule${cleaned.length === 1 ? '' : 's'}.`;
    void render();
  });
  const toolbar = el('div', 'toolbar');
  toolbar.append(add, save);
  section.append(list, toolbar, status);
  return section;
}

function allowlistSection(initial: readonly string[]): HTMLElement {
  const section = el('section');
  section.append(el('h2', undefined, 'Allowlist'));
  section.append(el('p', 'muted', 'One host per line. The engine runs only on these hosts.'));
  const textarea = el('textarea');
  textarea.value = initial.join('\n');
  const status = el('p', 'status');
  const save = el('button', 'primary', 'Save allowlist');
  save.addEventListener('click', async () => {
    const hosts = [
      ...new Set(textarea.value.split(/\s+/).map(normalizeHost).filter((host) => host !== '')),
    ];
    await saveSettings({ allowlist: hosts });
    status.textContent = `Saved ${hosts.length} host${hosts.length === 1 ? '' : 's'}.`;
    void render();
  });
  const toolbar = el('div', 'toolbar');
  toolbar.append(save);
  section.append(textarea, toolbar, status);
  return section;
}

function denylistSection(): HTMLElement {
  const section = el('section');
  section.append(el('h2', undefined, 'Hard denylist'));
  section.append(el('p', 'muted', 'Never scraped, never sent. Not editable from the popup.'));
  const list = el('ul', 'denylist');
  for (const host of HARD_DENYLIST) list.append(el('li', undefined, host));
  section.append(list);
  return section;
}

async function render(): Promise<void> {
  const settings = await loadSettings();
  const keyState = (await send<{ hasKey: boolean }>({ type: 'hasKey' })) ?? { hasKey: false };
  app.replaceChildren();
  app.append(el('h1', undefined, 'Polymorph options'));
  app.append(keySection(keyState.hasKey));
  app.append(rulesSection(settings.rules));
  app.append(allowlistSection(settings.allowlist));
  app.append(denylistSection());
}

void render();