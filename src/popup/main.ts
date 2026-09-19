import { canRunOnHost, hostFromUrl, isAllowlisted, isDenylisted, toggleHost } from '../hosts';
import { loadSettings, saveSettings } from '../settings';
import { el, row, switchControl } from '../ui/dom';

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

interface Readiness {
  tone: 'ok' | 'warn' | 'off' | 'deny';
  text: string;
}

/** US-007: one-line readiness statement first, in plain language. */
function readiness(args: {
  keyPresent: boolean;
  denied: boolean;
  host: string;
  masterEnabled: boolean;
  allowed: boolean;
  enabledRules: number;
}): Readiness {
  if (!args.keyPresent) return { tone: 'warn', text: 'Not set up — add your key' };
  if (args.denied) return { tone: 'deny', text: 'Never runs on this site' };
  if (!args.masterEnabled) return { tone: 'off', text: 'Paused everywhere' };
  if (args.host === '') return { tone: 'off', text: 'Nothing to do on this page' };
  if (!args.allowed) return { tone: 'off', text: 'Paused on this site' };
  if (args.enabledRules === 0) return { tone: 'warn', text: 'No rules enabled yet' };
  return {
    tone: 'ok',
    text: `Working here — ${args.enabledRules} rule${args.enabledRules === 1 ? '' : 's'} active`,
  };
}

async function render(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url ? hostFromUrl(tab.url) : '';
  const settings = await loadSettings();
  const keyState = (await send<{ hasKey: boolean }>({ type: 'hasKey' })) ?? { hasKey: false };
  const stats = (await send<{ transformed: number }>({ type: 'getTabStats', tabId: tab?.id })) ?? {
    transformed: 0,
  };
  const enabledRules = settings.rules.filter((rule) => rule.enabled).length;
  const denied = host !== '' && isDenylisted(host);
  const allowed = host !== '' && canRunOnHost(host, settings);
  const ready = readiness({
    keyPresent: keyState.hasKey,
    denied,
    host,
    masterEnabled: settings.masterEnabled,
    allowed,
    enabledRules,
  });

  app.replaceChildren();
  app.append(el('h1', undefined, 'Polymorph'));

  const banner = el('p', `banner banner--${ready.tone}`, ready.text);
  banner.setAttribute('role', 'status');
  app.append(banner);

  app.append(
    row(
      el('span', undefined, 'Rules active'),
      el('span', 'muted', `${enabledRules} of ${settings.rules.length}`),
    ),
  );
  app.append(
    row(
      el('span', undefined, 'Posts transformed here'),
      el('span', 'muted', String(stats.transformed)),
    ),
  );

  app.append(
    row(
      el('span', undefined, 'Polymorph enabled'),
      switchControl({
        label: 'Polymorph enabled',
        checked: settings.masterEnabled,
        showLabel: false,
        onChange: (checked) => {
          void saveSettings({ masterEnabled: checked }).then(render);
        },
      }),
    ),
  );

  if (host === '') {
    app.append(row(el('span', 'host', 'No site on this page'), el('span', 'muted', '—')));
  } else if (denied) {
    app.append(row(el('span', 'host', host), el('span', 'danger', 'Never runs here')));
  } else {
    const hostListed = isAllowlisted(host, settings.allowlist);
    app.append(
      row(
        el('span', 'host', host),
        switchControl({
          label: `Run on ${host}`,
          checked: hostListed,
          showLabel: false,
          onChange: () => {
            void saveSettings({ allowlist: toggleHost(settings.allowlist, host) }).then(render);
          },
        }),
      ),
    );
  }

  const options = el('button', 'primary', 'Options');
  options.addEventListener('click', () => chrome.runtime.openOptionsPage());
  const diagnostics = el('button', undefined, 'Diagnostics');
  diagnostics.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#diagnostics') });
  });
  const actions = el('div', 'toolbar');
  actions.append(options, diagnostics);
  app.append(actions);

  app.append(el('p', 'muted version', `v${chrome.runtime.getManifest().version}`));
}

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') void render();
});

void render();