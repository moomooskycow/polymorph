import { canRunOnHost, hostFromUrl, isDenylisted, toggleHost } from '../hosts';
import { loadSettings, saveSettings } from '../settings';

function requireApp(): HTMLElement {
  const node = document.getElementById('app');
  if (node === null) throw new Error('popup: #app missing');
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

function row(left: Node, right: Node): HTMLDivElement {
  const div = el('div', 'row');
  div.append(left, right);
  return div;
}

async function render(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url ? hostFromUrl(tab.url) : '';
  const settings = await loadSettings();
  const keyState = (await send<{ hasKey: boolean }>({ type: 'hasKey' })) ?? { hasKey: false };
  const stats = (await send<{ collapsed: number }>({ type: 'getStats', tabId: tab?.id })) ?? {
    collapsed: 0,
  };

  app.replaceChildren();
  app.append(el('h1', undefined, 'Polymorph'));

  const keyRow = row(
    el('span', undefined, 'OpenRouter key'),
    el('span', keyState.hasKey ? 'muted' : 'danger', keyState.hasKey ? 'Saved' : 'Missing'),
  );
  app.append(keyRow);
  if (!keyState.hasKey) {
    const setKey = el('button', 'primary', 'Set key in Options');
    setKey.addEventListener('click', () => chrome.runtime.openOptionsPage());
    app.append(setKey);
  }

  // US-005.4: master enable.
  const master = el('input');
  master.type = 'checkbox';
  master.checked = settings.masterEnabled;
  master.addEventListener('change', () => {
    void saveSettings({ masterEnabled: master.checked }).then(render);
  });
  const masterLabel = el('label');
  masterLabel.append(master, el('span', undefined, 'Enabled'));
  app.append(masterLabel);

  // US-005.2/.3 plus US-004.3: no unlock control on a denylisted host.
  const hostRow = el('div', 'row');
  hostRow.append(el('span', 'host', host || 'No host on this page'));
  if (host === '') {
    hostRow.append(el('span', 'muted', '—'));
  } else if (isDenylisted(host)) {
    hostRow.append(el('span', 'danger', 'Never runs here'));
  } else {
    const allowed = canRunOnHost(host, settings);
    const toggle = el('button', undefined, allowed ? 'On' : 'Off');
    toggle.setAttribute('aria-pressed', String(allowed));
    toggle.addEventListener('click', () => {
      void saveSettings({ allowlist: toggleHost(settings.allowlist, host) }).then(render);
    });
    hostRow.append(toggle);
  }
  app.append(hostRow);

  app.append(row(el('span', undefined, 'Collapsed on this tab'), el('span', 'muted', String(stats.collapsed))));

  const options = el('button', 'link-button', 'Options');
  options.addEventListener('click', () => chrome.runtime.openOptionsPage());
  app.append(options);
}

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') void render();
});

void render();