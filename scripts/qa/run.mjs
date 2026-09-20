#!/usr/bin/env node
/**
 * Polymorph browser QA — loads the BUILT MV3 extension into an isolated
 * persistent Chromium profile and exercises the real pipeline: extension
 * storage, service worker, content scripts, popup/options pages, DOM effects.
 *
 * Provider calls are served by a deterministic local mock (clearly labelled);
 * site fixtures are synthetic pages served locally and mapped to real host
 * names so the real adapters fire. Nothing here touches the principal's
 * browser, profile, or loaded extension.
 *
 * Usage:
 *   node scripts/qa/run.mjs --dist <path-to-dist> [--label name] [--out dir]
 *                           [--scenario name] [--full] [--live] [--headed]
 *
 * Docs: scripts/qa/README.md
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { startServer, QA_ENDPOINT } from './lib/server.mjs';
import { ensureFixtures } from './lib/fixtures.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(`--${name}`); }
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const DIST = resolve(opt('dist', join(process.cwd(), 'dist')));
const LABEL = opt('label', 'run');
const FULL = flag('full');
const LIVE = flag('live');
const HEADED = flag('headed');
const ONLY = opt('scenario', null);
const RUN_ID = `${new Date().toISOString().replace(/[:.]/g, '-')}-${LABEL}`;
const OUT = resolve(opt('out', join(homedir(), '.cache', 'polymorph-qa', 'runs', RUN_ID)));
const PROFILE = join(homedir(), '.cache', 'polymorph-qa', 'profiles', RUN_ID);
mkdirSync(OUT, { recursive: true });
mkdirSync(PROFILE, { recursive: true });
const FIXTURES = ensureFixtures(join(OUT, 'fixtures'));

const KEY = 'sk-or-qa-fixture-key-not-a-real-secret';
const BASE_ALLOWLIST = ['x.com', 'www.x.com', 'twitter.com', 'reddit.com', 'www.reddit.com', 'news.ycombinator.com', 'youtube.com', 'fixture.test'];
const RULES = [
  { id: 'rage-bait', name: 'Rage bait', instructions: 'The post is engineered to provoke outrage. Do not match calm technical posts.', enabled: true },
];

// ---------------------------------------------------------------------------
// Playwright resolution (no repo dependency required on this machine)
// ---------------------------------------------------------------------------
function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    '/home/phaedrus/.hermes/hermes-agent/node_modules/',
  ].filter(Boolean);
  for (const base of candidates) {
    try {
      const req = createRequire(base.endsWith('/') ? base : `${base}/`);
      return req('playwright-core');
    } catch { /* try next */ }
  }
  throw new Error('playwright-core not found; set PLAYWRIGHT_PATH to a node_modules dir containing it');
}
const { chromium } = loadPlaywright();

function chromiumPath() {
  if (process.env.POLYMORPH_CHROMIUM) return process.env.POLYMORPH_CHROMIUM;
  if (existsSync('/usr/sbin/chromium')) return '/usr/sbin/chromium';
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const candidate = join(cache, dir, rel);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error('no chromium found; set POLYMORPH_CHROMIUM to a chromium binary');
}

// ---------------------------------------------------------------------------
// Evidence / reporting
// ---------------------------------------------------------------------------
const results = [];
const shots = [];
let currentScenario = 'setup';
const scenarioPages = new Set();
async function shot(page, name, { fullPage = false } = {}) {
  const file = join(OUT, 'screenshots', `${String(shots.length + 1).padStart(2, '0')}-${name}.png`);
  mkdirSync(join(OUT, 'screenshots'), { recursive: true });
  try {
    await page.screenshot({ path: file, fullPage });
    shots.push({ name, file });
  } catch (error) {
    shots.push({ name, file: null, error: String(error) });
  }
}
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  results.push({ scenario: currentScenario, name, ok, detail });
  if (!ok) throw new Error(`assert failed: ${name}${detail ? ` — ${detail}` : ''}`);
}
function soft(name, condition, detail = '') {
  results.push({ scenario: currentScenario, name, ok: Boolean(condition), detail, soft: true });
}
async function scenario(name, fn) {
  if (ONLY && !ONLY.split(',').map((s) => s.trim()).includes(name)) return;
  currentScenario = name;
  const started = Date.now();
  try {
    await fn();
    results.push({ scenario: name, name: 'SCENARIO', ok: true, detail: `${Date.now() - started}ms` });
    console.log(`  PASS ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    results.push({ scenario: name, name: 'SCENARIO', ok: false, detail: String(error?.message ?? error) });
    console.log(`  FAIL ${name}: ${error?.message ?? error}`);
  } finally {
    for (const page of scenarioPages) await page.close().catch(() => {});
    scenarioPages.clear();
  }
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------
function hostResolverRules(hosts) {
  return hosts.map((h) => `MAP ${h} 127.0.0.1`).join(',');
}

async function launch({ mapFixtureHosts = true, profileSuffix = '', debugPort = null } = {}) {
  const hosts = ['openrouter.ai'];
  if (mapFixtureHosts) hosts.push('x.com', 'www.x.com', 'twitter.com', 'reddit.com', 'www.reddit.com', 'news.ycombinator.com', 'youtube.com', 'gmail.com', 'mail.google.com', 'fixture.test');
  const profile = PROFILE + profileSuffix;
  mkdirSync(profile, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: !HEADED,
    executablePath: chromiumPath(),
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      `--host-resolver-rules=${hostResolverRules(hosts)}`,
      ...(debugPort === null ? [] : [`--remote-debugging-port=${debugPort}`]),
      '--ignore-certificate-errors',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-client-side-phishing-detection',
      '--metrics-recording-only',
      '--no-service-autorun',
    ],
  });
  return ctx;
}

async function extensionId(ctx) {
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  return new URL(sw.url()).host;
}

const extPages = new WeakMap(); // ctx -> Map(key -> page). Per-context on purpose:
// two contexts can host the same extension id, and pages are not portable
// across contexts. Keying globally would hand a live context the main
// context's options page and silently skip its storage setup.
async function extPage(ctx, id, path) {
  let byKey = extPages.get(ctx);
  if (!byKey) { byKey = new Map(); extPages.set(ctx, byKey); }
  const key = `${id}/${path}`;
  const existing = byKey.get(key);
  if (existing && !existing.isClosed()) return existing;
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/${path}`);
  await page.waitForLoadState('domcontentloaded');
  byKey.set(key, page);
  return page;
}

async function setStorage(ctx, id, patch) {
  const page = await extPage(ctx, id, 'options.html');
  await page.evaluate(async (p) => { await chrome.storage.local.set(p); }, patch);
}
async function removeStorage(ctx, id, keys) {
  const page = await extPage(ctx, id, 'options.html');
  await page.evaluate(async (k) => { await chrome.storage.local.remove(k); }, keys);
}
async function configure(ctx, id, { key = KEY, rules = RULES, allowlist = BASE_ALLOWLIST, master = true, endpoint = QA_ENDPOINT } = {}) {
  const page = await extPage(ctx, id, 'options.html');
  const wanted = { endpoint, master, rules, allowlist, key };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.evaluate(async (cfg) => {
      const patch = { jevEndpointOverride: cfg.endpoint, masterEnabled: cfg.master, rules: cfg.rules, allowlist: cfg.allowlist };
      if (cfg.key === null) await chrome.storage.local.remove('openrouterKey');
      else patch.openrouterKey = cfg.key;
      await chrome.storage.local.set(patch);
    }, wanted);
    const actual = await page.evaluate(async () => {
      const raw = await chrome.storage.local.get(['rules', 'allowlist', 'openrouterKey', 'masterEnabled']);
      return { rules: raw.rules, allowlist: raw.allowlist, key: typeof raw.openrouterKey === 'string', master: raw.masterEnabled };
    });
    const rulesMatch =
      Array.isArray(actual.rules) &&
      actual.rules.length === rules.length &&
      actual.rules.every((rule, index) => rule.id === rules[index].id && rule.enabled === (rules[index].enabled ?? true));
    const allowlistMatch = Array.isArray(actual.allowlist) && allowlist.every((host) => actual.allowlist.includes(host));
    if (rulesMatch && allowlistMatch && actual.key === (key !== null) && actual.master === master) return;
    await page.waitForTimeout(250);
  }
  throw new Error('configure did not persist');
}

async function openFixture(ctx, url) {
  const page = await ctx.newPage();
  scenarioPages.add(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}

/** Cold-start helper: waits until the content script has injected. */
async function waitForContent(page, timeout = 30000) {
  await page
    .waitForFunction(
      () => document.documentElement.hasAttribute('data-polymorph-extension'),
      null,
      { timeout, polling: 100 },
    )
    .catch(() => {});
}

async function waitBars(page, n, timeout = 15000) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('polymorph-collapse, polymorph-card').length >= count,
    n,
    { timeout, polling: 100 },
  );
}

/** US-014: card image info for the media scenarios. */
async function cardMedia(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('polymorph-card')].map((card) => {
      const root = card.shadowRoot;
      const img = root?.querySelector('img') ?? null;
      const rect = card.getBoundingClientRect();
      return {
        src: img?.getAttribute('src') ?? null,
        mime: img?.getAttribute('data-media-mime') ?? null,
        frozen: img?.getAttribute('data-media-frozen') ?? null,
        text: (root?.textContent ?? '').trim(),
        height: Math.round(rect.height),
        hasShow: /show original/i.test(root?.innerHTML ?? ''),
      };
    }),
  );
}

async function waitCardImages(page, n, timeout = 15000) {
  await page.waitForFunction(
    (count) => {
      let found = 0;
      for (const card of document.querySelectorAll('polymorph-card')) {
        const src = card.shadowRoot?.querySelector('img')?.getAttribute('src') ?? '';
        if (src.startsWith('blob:') || src.startsWith('data:')) found += 1;
      }
      return found >= count;
    },
    n,
    { timeout, polling: 100 },
  );
}

async function mediaState(ctx, id) {
  return extPage(ctx, id, 'options.html').then((pg) =>
    pg.evaluate(async () => chrome.runtime.sendMessage({ type: 'media:list' })),
  );
}

async function clearMedia(ctx, id) {
  await extPage(ctx, id, 'options.html').then((pg) =>
    pg.evaluate(async () => chrome.runtime.sendMessage({ type: 'media:clear' })),
  );
}

async function addMedia(ctx, id, files, expected = files.length) {
  const options = await extPage(ctx, id, 'options.html');
  await options.setInputFiles('#media-input', files);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const state = await mediaState(ctx, id);
    if ((state?.usage?.count ?? 0) >= expected) return;
    await options.waitForTimeout(200);
  }
  throw new Error(`media add did not reach ${expected} item(s)`);
}

const ALLOWED_HOSTS = new Set([
  'x.com', 'www.x.com', 'twitter.com', 'reddit.com', 'www.reddit.com',
  'news.ycombinator.com', 'youtube.com', 'gmail.com', 'mail.google.com',
  'fixture.test', 'openrouter.ai',
]);

function isAllowedRequest(url) {
  if (
    url.startsWith('chrome-extension://') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://')
  ) {
    return true;
  }
  try {
    return ALLOWED_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Waits until the collapsed-bar count stops changing (settles the async pipeline). */
async function waitStableBars(page, timeout = 12000) {
  const start = Date.now();
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() - start < timeout) {
    const count = await page.evaluate(() => document.querySelectorAll('polymorph-collapse, polymorph-card').length);
    if (count !== last) {
      last = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince > 700 && last > 0) {
      return last;
    }
    await page.waitForTimeout(200);
  }
  return last;
}

async function barInfo(page) {
  return page.evaluate(() => {
    const bars = [...document.querySelectorAll('polymorph-collapse, polymorph-card')];
    return bars.map((bar) => {
      const root = bar.shadowRoot;
      const rect = bar.getBoundingClientRect();
      const html = root ? root.innerHTML : '';
      return {
        hash: html.length + ':' + html.slice(0, 220),
        full: html,
        text: root ? (root.textContent || '').trim() : '',
        hasSvg: root ? root.querySelector('svg') !== null : false,
        assetIds: root ? [...root.querySelectorAll('[data-asset]')].map((el) => el.getAttribute('data-asset')) : [],
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        animations: root
          ? [...root.querySelectorAll('*')].map((el) => {
              const s = getComputedStyle(el);
              return { name: s.animationName, duration: s.animationDuration, state: s.animationPlayState };
            }).filter((a) => a.name && a.name !== 'none')
          : [],
      };
    });
  });
}

async function contrastAudit(page, selectors) {
  return page.evaluate((sels) => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(',').map((x) => parseFloat(x));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const l1 = lum(a), l2 = lum(b);
      const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
      return (hi + 0.05) / (lo + 0.05);
    };
    const effBg = (el) => {
      let n = el;
      while (n) {
        const bg = parse(getComputedStyle(n).backgroundColor);
        if (bg && bg.a > 0.9) return bg;
        n = n.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const resolve = (sel) => {
      const [hostSel, innerSel] = sel.split('>>>').map((s) => s.trim());
      const host = document.querySelector(hostSel);
      if (!host) return null;
      return innerSel ? host.shadowRoot?.querySelector(innerSel) ?? null : host;
    };
    const out = [];
    for (const sel of sels) {
      const el = resolve(sel);
      if (!el) { out.push({ sel, missing: true }); continue; }
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      const bg = effBg(el);
      const size = parseFloat(cs.fontSize);
      const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      out.push({
        sel,
        ratio: fg ? Math.round(ratio(fg, bg) * 100) / 100 : null,
        size,
        large,
        text: (el.textContent ?? '').trim().slice(0, 30),
      });
    }
    return out;
  }, selectors);
}

function auditContrast(rows, label) {
  for (const row of rows) {
    if (row.missing || row.ratio === null) {
      soft(`${label} ${row.sel} measurable`, false, 'element missing');
      continue;
    }
    const min = row.large ? 3 : 4.5;
    check(
      `${label} ${row.sel} contrast >= ${min}`,
      row.ratio >= min,
      `${row.ratio}:1 (${row.size}px) "${row.text}"`,
    );
  }
}

async function postHidden(page, qa) {
  return page.evaluate((sel) => {
    const el = document.querySelector(`[data-qa="${sel}"]`);
    if (!el) return null;
    return getComputedStyle(el).display === 'none';
  }, qa);
}

/** Waits for the extension's async pipeline to settle (idle scans, in-flight calls). */
async function page_settle(ms = 1200) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickRestore(page, index = 0) {
  await page.evaluate((i) => {
    const bars = [...document.querySelectorAll('polymorph-collapse, polymorph-card')];
    const bar = bars[i];
    const button = bar?.shadowRoot?.querySelector('button');
    button?.click();
  }, index);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const { server, provider, port } = await startServer({ distDir: DIST });
console.log(`QA run ${RUN_ID}`);
console.log(`dist:    ${DIST}`);
console.log(`out:     ${OUT}`);
console.log(`profile: ${PROFILE}`);
console.log(`fixture server on 127.0.0.1:${port}`);

const ctx = await launch({ debugPort: 9223 }); // CDP reach for the real action popup
const requests = [];
ctx.on('request', (r) => requests.push({ url: r.url(), at: Date.now() }));

let extId = null;
try {
  extId = await extensionId(ctx);
  console.log(`extension id: ${extId}`);
} catch (error) {
  console.log(`FATAL: extension failed to load: ${error.message}`);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ fatal: String(error), results }, null, 2));
  await ctx.close(); server.close(); process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));

try {
  await scenario('extension-loads', async () => {
    check('service worker registered', extId !== null, extId ?? 'no id');
    check('manifest is MV3', manifest.manifest_version === 3);
  });

  await scenario('options-first-run', async () => {
    const options = await extPage(ctx, extId, 'options.html');
    await options.reload();
    const text = await options.locator('body').innerText();
    check('options page renders', text.includes('Polymorph'), text.slice(0, 80));
    soft('first-run guidance present', /get set up|3 steps|enable rule|add your key|openrouter key below/i.test(text), text.slice(0, 200));
    soft('explicit Enable rule switch label', /enable rule/i.test(text), 'no Enable rule label');
    soft('enabled-rule count shown', /\d+\s+of\s+\d+\s+rules/i.test(text), 'no count summary');
    await shot(options, 'options-first-run-light', { fullPage: true });
    await options.emulateMedia({ colorScheme: 'dark' });
    await shot(options, 'options-first-run-dark', { fullPage: true });
    await options.emulateMedia({ colorScheme: 'light' });
  });

  await scenario('icons-present', async () => {
    const icons = manifest.icons ?? {};
    check('manifest.icons has 16/32/48/128', ['16', '32', '48', '128'].every((s) => icons[s]), JSON.stringify(icons));
    for (const [size, file] of Object.entries(icons)) {
      const p = join(DIST, file);
      check(`icon file exists ${file}`, existsSync(p), file);
      const buf = readFileSync(p);
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      check(`icon ${file} is ${size}px`, w === Number(size) && h === Number(size), `${w}x${h}`);
    }
    check('action.default_icon present', Boolean(manifest.action?.default_icon), JSON.stringify(manifest.action));
  });

  await scenario('fixture-collapse-basic', async () => {
    provider.reset(); provider.setMode('ok');
    await configure(ctx, extId, {});
    const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN1`);
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-qa="post-0"]');
      return el !== null && getComputedStyle(el).display === 'none';
    }, null, { polling: 100, timeout: 15000 }).catch(() => {});
    await waitBars(page, 1);
    check('provider was called', provider.count() > 0, String(provider.count()));
    const hidden = await postHidden(page, 'post-0');
    check('first post hidden after collapse', hidden === true, String(hidden));
    const bars = await barInfo(page);
    check('bar has shadow content', bars[0].text.length > 0, bars[0].text.slice(0, 80));
    check('card has a Show original control', /show original|restore/i.test(bars[0].full), bars[0].full.slice(0, 160));
    soft('bar bounded width', bars[0].width <= 600, `${bars[0].width}px`);
    soft('bar bounded height', bars[0].height <= 220, `${bars[0].height}px`);
    soft('empty library card has no image', !bars[0].full.includes('<img'), 'img in empty-library card');
    await shot(page, 'feed-collapsed');
    // Interactivity preserved
    const clicks = await page.evaluate(() => {
      document.querySelector('[data-qa="like-1"]')?.click();
      return true;
    });
    check('page remains interactive', clicks === true);
    // Privacy: request body carries site + text only, not the key value beyond the auth header
    const body = provider.lastBody();
    soft('provider body is JSON with state+questions', body.includes('"state"') && body.includes('"questions"'), body.slice(0, 120));
    check('provider body carries no cookie/session markers', !/cookie|sessionid|csrf/i.test(body), body.slice(0, 120));
  });

  await scenario('restore-one-click', async () => {
    await configure(ctx, extId, {});
    const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN2`);
    await waitBars(page, 3);
    const barsBefore = await waitStableBars(page);
    const before = provider.count();
    await clickRestore(page, 0);
    await page.waitForTimeout(700);
    const hidden = await postHidden(page, 'post-0');
    check('post visible after restore', hidden === false, String(hidden));
    const barsAfter = (await barInfo(page)).length;
    check('restored bar removed', barsAfter === barsBefore - 1, `${barsBefore} -> ${barsAfter}`);
    check('no re-evaluation after restore', provider.count() === before, `${before} -> ${provider.count()}`);
  });

  await scenario('appended-posts', async () => {
    await configure(ctx, extId, {});
    const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN3`);
    await waitBars(page, 1);
    await page.evaluate(() => {
      const main = document.getElementById('feed');
      const article = document.createElement('article');
      article.setAttribute('data-testid', 'tweet');
      article.setAttribute('data-qa', 'appended-0');
      article.innerHTML = '<span class="txt">FIXTURE_SCEN3_APPENDED A freshly appended post after infinite scroll, long enough and baiting.</span>';
      main.appendChild(article);
    });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-qa="appended-0"]');
      return el && getComputedStyle(el).display === 'none';
    }, null, { polling: 100, timeout: 10000 }).catch(() => {});
    const hidden = await postHidden(page, 'appended-0');
    check('appended post collapsed', hidden === true, String(hidden));
  });

  await scenario('recycled-node', async () => {
    await configure(ctx, extId, {});
    // Phase 1: a post marked as left (gate miss) gets recycled content that matches.
    provider.setMode('nomatch');
    const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN4`);
    await page.waitForTimeout(2500); // posts evaluated and marked left under nomatch
    provider.setMode('ok');
    await page.evaluate(() => {
      const el = document.querySelector('[data-qa="post-0"] .txt');
      if (el) el.textContent = 'FIXTURE_SCEN4_RECYCLED A recycled virtualized node with brand new rage-bait content, long enough to process.';
    });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-qa="post-0"]');
      return el && getComputedStyle(el).display === 'none';
    }, null, { polling: 100, timeout: 10000 }).catch(() => {});
    const hidden = await postHidden(page, 'post-0');
    check('recycled left node re-evaluated and collapsed', hidden === true, String(hidden));

    // Phase 2: a collapsed node gets recycled with content that does NOT match;
    // it must be un-collapsed and re-evaluated (fail-open to visible).
    provider.setMode('ok');
    const page2 = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN4B`);
    await waitBars(page2, 1);
    provider.setMode('nomatch');
    await page2.evaluate(() => {
      const el = document.querySelector('[data-qa="post-0"] .txt');
      if (el) el.textContent = 'FIXTURE_SCEN4B_RECYCLED Calm knitting notes about winter scarves and tea, nothing provocative.';
    });
    await page2.waitForFunction(() => {
      const el = document.querySelector('[data-qa="post-0"]');
      return el && getComputedStyle(el).display !== 'none';
    }, null, { polling: 100, timeout: 10000 }).catch(() => {});
    const hidden2 = await postHidden(page2, 'post-0');
    check('collapsed recycled node restored when content no longer matches', hidden2 === false, String(hidden2));
    provider.setMode('ok');
  });

  await scenario('disable-restores', async () => {
    await configure(ctx, extId, {});
    const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN5`);
    await waitBars(page, 1);
    await setStorage(ctx, extId, { masterEnabled: false });
    await page.waitForFunction(() => document.querySelectorAll('polymorph-collapse, polymorph-card').length === 0, null, { timeout: 8000, polling: 100 }).catch(() => {});
    const bars = await barInfo(page);
    const hidden = await postHidden(page, 'post-0');
    check('bars removed when disabled', bars.length === 0, `${bars.length} bars remain`);
    check('posts restored when disabled', hidden === false, String(hidden));
    await setStorage(ctx, extId, { masterEnabled: true });
  });

  await scenario('no-key', async () => {
    await configure(ctx, extId, { key: null });
    provider.reset();
    const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN6`);
    await page.waitForTimeout(2500);
    check('no provider calls without key', provider.count() === 0, String(provider.count()));
    const bars = await barInfo(page);
    check('nothing collapsed without key', bars.length === 0, `${bars.length} bars`);
    await configure(ctx, extId, {});
  });

  await scenario('no-rules', async () => {
    await configure(ctx, extId, { rules: RULES.map((r) => ({ ...r, enabled: false })) });
    provider.reset();
    const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN7`);
    await page.waitForTimeout(2500);
    check('no provider calls with no enabled rules', provider.count() === 0, String(provider.count()));
    const bars = await barInfo(page);
    check('nothing collapsed with no rules', bars.length === 0, `${bars.length} bars`);
    await configure(ctx, extId, {});
  });

  await scenario('enable-rule-flow', async () => {
    // The user-confirmed diagnosis: enabling a rule through the options UI must
    // be discoverable and must make filtering work.
    await configure(ctx, extId, { rules: RULES.map((r) => ({ ...r, enabled: false })) });
    provider.reset(); provider.setMode('ok');
    const options = await extPage(ctx, extId, 'options.html');
    await options.reload();
    await options.waitForTimeout(400);
    const clicked = await options.evaluate(() => {
      const article = document.querySelector('article[data-rule-id="rage-bait"]')
        ?? document.querySelector('article.rule')
        ?? [...document.querySelectorAll('article')].find((el) => /rage bait/i.test(el.textContent ?? ''));
      if (!article) return 'no-rule-row';
      const control = article.querySelector('input[type="checkbox"], [role="switch"], button[aria-pressed], input[type="radio"]');
      if (!control) return 'no-enable-control';
      control.click();
      return 'control-clicked';
    });
    check('options UI exposes an enable control for a rule', clicked === 'control-clicked', clicked);
    await options.evaluate(() => {
      const article = document.querySelector('article[data-rule-id="rage-bait"]')
        ?? document.querySelector('article.rule');
      const scope = article?.closest('section') ?? document;
      const save = [...scope.querySelectorAll('button')].find((b) => /save/i.test(b.textContent ?? ''));
      save?.click();
    });
    await options.waitForTimeout(700);
    const rulesAfter = await options.evaluate(async () => (await chrome.storage.local.get('rules')).rules);
    const enabledAfter = Array.isArray(rulesAfter) && rulesAfter.some((r) => r.enabled);
    soft('storage shows an enabled rule after UI enable + save', enabledAfter, JSON.stringify(rulesAfter));
    const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCENENABLE`);
    await waitBars(page, 1, 15000).catch(() => {});
    const bars = await barInfo(page);
    check('filtering works after enabling a rule through the UI', bars.length >= 1, `${bars.length} bars`);
    await configure(ctx, extId, {});
  });

  await scenario('restricted-site', async () => {
    await page_settle(1500); // let stragglers from earlier scenarios land
    provider.reset();
    const page = await openFixture(ctx, `https://gmail.com:${port}/mail`);
    await page.waitForTimeout(2000);
    check('no provider calls on denylisted host', provider.count() === 0, String(provider.count()));
    const bars = await barInfo(page);
    check('nothing collapsed on denylisted host', bars.length === 0, `${bars.length} bars`);
  });

  await scenario('provider-401', async () => {
    await configure(ctx, extId, {});
    provider.reset(); provider.setMode('401');
    const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN8A`);
    await page.waitForTimeout(2500);
    const bars = await barInfo(page);
    check('401 leaves posts visible', bars.length === 0, `${bars.length} bars`);
    check('401 attempt was made', provider.count() > 0, String(provider.count()));
    provider.setMode('ok');
  });

  
  
  await scenario('provider-malformed', async () => {
    await configure(ctx, extId, {});
    provider.reset(); provider.setMode('malformed');
    const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN8D`);
    await page.waitForTimeout(2500);
    const bars = await barInfo(page);
    check('malformed envelope leaves posts visible', bars.length === 0, `${bars.length} bars`);
    provider.setMode('ok');
  });

  await scenario('gate-no-match', async () => {
    await configure(ctx, extId, {});
    provider.reset(); provider.setMode('nomatch');
    const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN8E`);
    await page.waitForTimeout(2500);
    const bars = await barInfo(page);
    check('gate miss leaves posts visible', bars.length === 0, `${bars.length} bars`);
    provider.setMode('ok');
  });

  await scenario('media-empty-collapse', async () => {
    const c = await launch({ profileSuffix: '-media-empty' });
    try {
      const id = await extensionId(c);
      await configure(c, id, {});
      await clearMedia(c, id);
      const page = await c.newPage();
      await page.goto(`https://x.com:${port}/feed?tag=SCENMEDIA1`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForContent(page);
      await waitBars(page, 1);
      const cards = await cardMedia(page);
      check('empty library still transforms matched posts', cards.length >= 1, `${cards.length} cards`);
      check('empty library cards have no image', cards.every((card) => card.src === null), JSON.stringify(cards.map((card) => card.src)));
      check('empty library cards keep Show original', cards.every((card) => card.hasShow), 'missing restore');
      const emptyText = await extPage(c, id, 'options.html').then((pg) => pg.locator('.media-empty').innerText());
      check(
        'options shows the exact empty-state copy',
        emptyText.includes('Add images or GIFs to replace filtered posts. Without images, posts are collapsed.'),
        emptyText,
      );
    } finally {
      await c.close();
    }
  });

  await scenario('media-add-and-render', async () => {
    const suffix = '-media-add';
    let c = await launch({ profileSuffix: suffix });
    try {
      let id = await extensionId(c);
      await configure(c, id, {});
      await clearMedia(c, id);
      const mediaRequests = [];
      c.on('request', (r) => mediaRequests.push(r.url()));
      await addMedia(c, id, [FIXTURES.png]);
      const options = await extPage(c, id, 'options.html');
      await options.reload();
      await options.waitForTimeout(500);
      const listed = await mediaState(c, id);
      check('added asset is in the library', listed?.ok === true && listed.usage?.count === 1, JSON.stringify(listed?.usage));
      check('options renders a thumbnail for the asset', (await options.locator('.media-item img').count()) >= 1, 'no thumbnail');

      const page = await c.newPage();
      await page.goto(`https://x.com:${port}/feed?tag=SCENMEDIA2`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForContent(page);
      await waitCardImages(page, 1);
      const cards = await cardMedia(page);
      const imgCard = cards.find((card) => card.src !== null);
      check('card renders the user image from a local object URL', imgCard?.src?.startsWith('blob:') === true, imgCard?.src ?? 'no image');
      check('card image is bounded', (imgCard?.height ?? 0) <= 240, `${imgCard?.height}px`);
      check('card keeps Show original', imgCard?.hasShow === true, 'missing restore');
      await shot(page, 'media-add-render');

      // Restart the extension (same profile, same IndexedDB) and confirm persistence.
      await c.close();
      c = await launch({ profileSuffix: suffix });
      id = await extensionId(c);
      await configure(c, id, {});
      const afterRestart = await mediaState(c, id);
      check('library persists across an extension restart', afterRestart?.ok === true && afterRestart.usage?.count === 1, JSON.stringify(afterRestart?.usage));
      const page2 = await c.newPage();
      await page2.goto(`https://x.com:${port}/feed?tag=SCENMEDIA2B`);
      await page2.reload({ waitUntil: 'domcontentloaded' });
      await waitForContent(page2);
      await waitCardImages(page2, 1);
      check('restarted worker still renders the persisted image', (await cardMedia(page2)).some((card) => card.src?.startsWith('blob:')), 'no blob image after restart');
      const external = mediaRequests.filter((url) => !isAllowedRequest(url));
      check('media rendering made no external asset requests', external.length === 0, external.slice(0, 3).join(', '));
    } finally {
      await c.close().catch(() => {});
    }
  });

  await scenario('media-multiple-stable', async () => {
    const c = await launch({ profileSuffix: '-media-multi' });
    try {
      const id = await extensionId(c);
      await configure(c, id, {});
      await clearMedia(c, id);
      await addMedia(c, id, [FIXTURES.png, FIXTURES.png2, FIXTURES.png3]);
      const listed = await mediaState(c, id);
      check('three assets are listed', listed?.ok === true && listed.usage?.count === 3, JSON.stringify(listed?.usage));

      const page = await c.newPage();
      await page.goto(`https://x.com:${port}/feed?tag=SCENMEDIA3`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForContent(page);
      await waitStableBars(page);
      await waitCardImages(page, 1);
      await page.waitForTimeout(500);
      const cards = await cardMedia(page);
      const sources = new Set(cards.map((card) => card.src).filter((src) => src !== null));
      soft('cards draw from more than one asset', sources.size >= 2, `${sources.size} distinct of ${cards.length} cards`);
      const before = await page.evaluate(() => document.querySelector('polymorph-card')?.shadowRoot?.querySelector('img')?.getAttribute('src') ?? null);
      await page.evaluate(() => {
        const el = document.querySelector('[data-qa="post-0"] .txt');
        if (el) el.textContent = el.textContent; // same text, fresh mutation
      });
      await page.waitForTimeout(1200);
      const after = await page.evaluate(() => document.querySelector('polymorph-card')?.shadowRoot?.querySelector('img')?.getAttribute('src') ?? null);
      check('same post keeps the same asset across rerenders', before !== null && before === after, `${before} -> ${after}`);
      await shot(page, 'media-multiple');
    } finally {
      await c.close();
    }
  });

  await scenario('media-remove-and-reject', async () => {
    const c = await launch({ profileSuffix: '-media-remove' });
    try {
      const id = await extensionId(c);
      await configure(c, id, {});
      await clearMedia(c, id);
      await addMedia(c, id, [FIXTURES.png]);
      const options = await extPage(c, id, 'options.html');
      await options.reload();
      await options.waitForTimeout(500);
      await options.locator('.media-remove').first().click();
      await options.waitForTimeout(700);
      const empty = await options.locator('.media-empty').innerText();
      check('removing the final item returns to the empty state', empty.includes('Without images, posts are collapsed.'), empty);

      await options.setInputFiles('#media-input', [FIXTURES.corruptPng, FIXTURES.svg]);
      await options.waitForTimeout(1000);
      const statusText = await options.locator('.media-status').innerText();
      check('corrupt file rejected with visible feedback', /corrupt|decoded/i.test(statusText), statusText);
      check('SVG rejected with visible feedback', /unsupported format|svg/i.test(statusText), statusText);
      const afterReject = await mediaState(c, id);
      check('rejected files never enter the library', afterReject?.usage?.count === 0, JSON.stringify(afterReject?.usage));

      const page = await c.newPage();
      await page.goto(`https://x.com:${port}/feed?tag=SCENMEDIA4`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForContent(page);
      await waitBars(page, 1);
      const cards = await cardMedia(page);
      check('rejected bytes never render in a card', cards.every((card) => card.src === null), JSON.stringify(cards.map((card) => card.src)));
    } finally {
      await c.close();
    }
  });

  await scenario('media-no-external-requests', async () => {
    const c = await launch({ profileSuffix: '-media-net' });
    try {
      const id = await extensionId(c);
      await configure(c, id, {});
      await clearMedia(c, id);
      await addMedia(c, id, [FIXTURES.png]);
      const mediaRequests = [];
      c.on('request', (r) => mediaRequests.push(r.url()));
      const page = await c.newPage();
      await page.goto(`https://x.com:${port}/feed?tag=SCENMEDIA5`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForContent(page);
      await waitCardImages(page, 1);
      const bad = mediaRequests.filter(
        (url) => !isAllowedRequest(url) || /fixture[^/]*\.(png|gif|svg)/i.test(url),
      );
      check('no external or fixture-hosted asset requests while media renders', bad.length === 0, bad.slice(0, 5).join(', '));
      const sources = await page.evaluate(() =>
        [...document.querySelectorAll('polymorph-card')]
          .map((card) => card.shadowRoot?.querySelector('img')?.getAttribute('src'))
          .filter((src) => typeof src === 'string'),
      );
      check(
        'every card image is a local object or data URL',
        sources.length >= 1 && sources.every((src) => src?.startsWith('blob:') || src?.startsWith('data:')),
        JSON.stringify(sources),
      );
    } finally {
      await c.close();
    }
  });

  await scenario('reduced-motion', async () => {
    const c = await launch({ profileSuffix: '-reduced' });
    try {
      const id = await extensionId(c);
      await configure(c, id, {});
      await clearMedia(c, id);
      await addMedia(c, id, [FIXTURES.gif]);
      const page = await c.newPage();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`https://x.com:${port}/feed?tag=SCEN10`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForContent(page);
      await waitBars(page, 1);
      await page.waitForTimeout(900);
      const animatedGifs = await page.evaluate(
        () => document.querySelectorAll('polymorph-card img[data-media-mime="image/gif"]').length,
      );
      check('reduced motion never renders an animating GIF', animatedGifs === 0, String(animatedGifs));
      const cards = await cardMedia(page);
      const frozen = cards.filter((card) => card.frozen === 'true').length;
      const collapsed = cards.filter((card) => card.src === null).length;
      soft('reduced motion freezes the GIF or collapses it', frozen + collapsed >= 1, JSON.stringify({ frozen, collapsed }));
      const bars = await barInfo(page);
      const running = bars.flatMap((b) => b.animations).filter((a) => a.state === 'running' && parseFloat(a.duration) > 0);
      check('no running animations under reduced motion', running.length === 0, JSON.stringify(running));
      const rmFlag = await page.evaluate(() =>
        [...document.querySelectorAll('polymorph-card')].every((el) => el.getAttribute('data-reduced-motion') === 'true'),
      );
      soft('cards flag reduced motion', rmFlag, 'data-reduced-motion not true');
      await shot(page, 'reduced-motion-feed');
    } finally {
      await c.close();
    }
  });

  await scenario('popup-states', async () => {
    await configure(ctx, extId, {});
    const fixture = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN11`);
    await waitBars(fixture, 1);

    // (1) The REAL action popup, reached through a CDP attach: Playwright does
    // not surface action popups as context pages, but the popup window is a
    // real page target on the browser's debug port.
    await fixture.bringToFront();
    await extPage(ctx, extId, 'options.html').then((pg) => pg.evaluate(() => chrome.action.openPopup?.().catch(() => {})));
    try {
      const cdp = await chromium.connectOverCDP('http://127.0.0.1:9223');
      let realPopup = null;
      for (let i = 0; i < 24 && realPopup === null; i += 1) {
        await page_settle(250);
        realPopup =
          cdp.contexts().flatMap((c) => c.pages()).find((pg) => pg.url().includes('popup.html')) ?? null;
      }
      if (realPopup !== null) {
        const realText = await realPopup.locator('body').innerText().catch(() => '');
        check('real action popup renders', realText.includes('Polymorph'), realText.slice(0, 120));
        soft('real action popup readiness visible', /working|paused|nothing|set up|rules/i.test(realText), realText.slice(0, 160));
        // activeTab is only granted by a real toolbar click; automation cannot
        // produce one, so the host row is expected to read "No site" here.
        soft(
          'real action popup host (needs a user gesture for activeTab)',
          realText.includes('x.com'),
          `automation cannot grant activeTab; text="${realText.replace(/\n/g, ' ').slice(0, 100)}"`,
        );
      } else {
        soft('real action popup reached via CDP', false, 'popup target not found');
      }
      await cdp.close().catch(() => {});
    } catch (error) {
      soft('real action popup reached via CDP', false, String(error).slice(0, 140));
    }

    // (2) Visible host + site toggle + Options, on a real tab whose URL the
    // extension can read. openrouter.ai is the standing host permission, so it
    // stands in for "supported site" here (activeTab cannot be granted without
    // a real toolbar click).
    await setStorage(ctx, extId, { allowlist: [...BASE_ALLOWLIST, 'openrouter.ai'] });
    const hostTab = await ctx.newPage();
    scenarioPages.add(hostTab);
    await hostTab.goto(`https://openrouter.ai:${port}/popup-fixture`);
    // Order matters: creating the popup page activates it; bring the host tab
    // to the front AFTER that, then reload the popup so its render sees the
    // host tab as the active tab (reload does not steal activation).
    const popup = await extPage(ctx, extId, 'popup.html');
    await hostTab.bringToFront();
    await popup.reload();
    await popup.waitForTimeout(900);
    const text = await popup.locator('body').innerText();
    check('popup renders', text.includes('Polymorph'), text.slice(0, 60));
    check('popup visibly shows the current host', text.includes('openrouter.ai'), text.slice(0, 220));
    check('popup readiness line reads working for the host', /Working here/i.test(text), text.slice(0, 220));
    soft('popup shows enabled rule count', /rule/i.test(text), 'no rule info');
    soft('popup shows transformed count row', /transformed/i.test(text), 'no stats row');
    soft('popup has diagnostics entry', /diagnostic/i.test(text), 'no diagnostics link');
    const popupRows = await contrastAudit(popup, ['h1', 'p.muted', '.banner', '.host']);
    auditContrast(popupRows, 'popup-light');
    await shot(popup, 'popup-light');
    await popup.emulateMedia({ colorScheme: 'dark' });
    await shot(popup, 'popup-dark');
    await popup.emulateMedia({ colorScheme: 'light' });

    // Site toggle: flip OFF, read the allowlist back, flip ON again.
    const siteSwitch = popup.locator('input[aria-label="Run on openrouter.ai"]');
    if ((await siteSwitch.count()) === 1) {
      await popup.evaluate(() => document.querySelector('input[aria-label="Run on openrouter.ai"]')?.click());
      await popup.waitForTimeout(600);
      const afterOff = await extPage(ctx, extId, 'options.html').then((pg) =>
        pg.evaluate(async () => (await chrome.storage.local.get('allowlist')).allowlist),
      );
      check('site toggle removes the host from the allowlist', Array.isArray(afterOff) && !afterOff.includes('openrouter.ai'), JSON.stringify(afterOff));
      const offText = await popup.locator('body').innerText();
      check('popup shows paused-on-this-site after toggle off', /Paused on this site/i.test(offText), offText.slice(0, 160));
      await popup.evaluate(() => document.querySelector('input[aria-label="Run on openrouter.ai"]')?.click());
      await popup.waitForTimeout(600);
      const afterOn = await extPage(ctx, extId, 'options.html').then((pg) =>
        pg.evaluate(async () => (await chrome.storage.local.get('allowlist')).allowlist),
      );
      check('site toggle adds the host back', Array.isArray(afterOn) && afterOn.includes('openrouter.ai'), JSON.stringify(afterOn));
    } else {
      soft('site toggle present for the host', false, 'no Run-on switch found');
    }

    // Options control.
    const optionsBefore = ctx.pages().filter((pg) => pg.url().includes('options.html')).length;
    await Promise.all([
      ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null),
      popup.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Options');
        b?.click();
      }),
    ]);
    await page_settle(600);
    const optionsOpen = ctx.pages().some((pg) => pg.url().includes('options.html'));
    check('popup Options control reaches the options page', optionsOpen, `options tabs before=${optionsBefore}, after found=${optionsOpen}`);
  });

  await scenario('options-configured', async () => {
    const options = await extPage(ctx, extId, 'options.html');
    await options.reload();
    await options.waitForTimeout(500);
    const text = await options.locator('body').innerText();
    soft('key shown as saved', /saved|present|ok/i.test(text), text.slice(0, 200));
    soft('enable rule affordance', /enable rule/i.test(text), 'no explicit enable label');
    soft('active/off status chip', /active|off\b/i.test(text), 'no status chip');
    soft('replacement media section present', /replacement media/i.test(text), 'no media section');
    soft('media empty-state copy visible', /add images or gifs/i.test(text), 'no media copy');
    soft('diagnostics section', /diagnostic/i.test(text), 'no diagnostics');
    soft('test connection affordance', /test connection/i.test(text), 'no test button');
    const lightRows = await contrastAudit(options, [
      'h1', 'p.muted', '.summary', '.status', '.stat-label', '.stat-value', '.chip', '.field-label', '.denylist li',
    ]);
    auditContrast(lightRows, 'options-light');
    await shot(options, 'options-configured-light', { fullPage: true });
    await options.emulateMedia({ colorScheme: 'dark' });
    await options.waitForTimeout(200);
    const darkRows = await contrastAudit(options, ['h1', 'p.muted', '.summary', '.stat-label', '.chip']);
    auditContrast(darkRows, 'options-dark');
    await shot(options, 'options-configured-dark', { fullPage: true });
    await options.emulateMedia({ colorScheme: 'light' });
  });

  await scenario('diagnostics-truthfulness', async () => {
    const options = await extPage(ctx, extId, 'options.html');
    await options.reload();
    await options.waitForTimeout(600);
    const text = await options.locator('body').innerText();
    const hasCounters = /discovered|evaluated|transformed|collapsed|queued/i.test(text);
    soft('diagnostics counters visible', hasCounters, text.slice(0, 300));
    check('diagnostics never show the key value', !text.includes(KEY), 'KEY LEAKED');
    check('diagnostics never show post text', !text.includes('FIXTURE_'), 'post text leaked');
    check('diagnostics never show media file names', !/fixture[-_a-z0-9]*\.(png|gif|jpe?g|webp)/i.test(text), 'media file name leaked');
  });

  await scenario('no-external-requests', async () => {
    const bad = requests.filter((r) => !isAllowedRequest(r.url));
    check('no unexpected external requests', bad.length === 0, bad.slice(0, 5).map((r) => r.url).join(', '));
  });

  if (LIVE) {
    console.log('  [live] bounded live-site smoke (real DOM, mock provider) — separate context');
    const liveCtx = await launch({ mapFixtureHosts: false, profileSuffix: '-live' });
    try {
      const liveId = await extensionId(liveCtx);
      const page = await liveCtx.newPage();
      const liveRequests = [];
      liveCtx.on('request', (r) => liveRequests.push(r.url()));
      await configure(liveCtx, liveId, {});
      provider.reset();
      await page.goto('https://news.ycombinator.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
      const live = await scenario('live-hn-smoke', async () => {
        await waitBars(page, 1, 20000).catch(async () => {
          const diag = await page.evaluate(() => ({
            title: document.title,
            href: location.href,
            rows: document.querySelectorAll('.athing').length,
            cards: document.querySelectorAll('polymorph-card, polymorph-collapse').length,
            firstRowText: document.querySelector('.athing')?.innerText?.slice(0, 120) ?? null,
            scriptInjected: Boolean(document.querySelector('.athing')?.getAttribute('data-polymorph-state')),
          })).catch(() => ({}));
          const extDiag = await extPage(liveCtx, liveId, 'options.html')
            .then((pg) => pg.evaluate(async () => chrome.runtime.sendMessage({ type: 'getDiagnostics' })))
            .catch(() => null);
          console.log('  [live-debug]', JSON.stringify(diag), 'providerRequests=', provider.count(),
            'extDiag=', JSON.stringify(extDiag && { paused: extDiag.paused, activeRules: extDiag.activeRules, totals: extDiag.totals }));
        });
        await waitBars(page, 1, 20000);
        const bars = await barInfo(page);
        check('live HN collapsed at least one row', bars.length >= 1, `${bars.length} bars`);
        await shot(page, 'live-hn-collapsed');
        const external = liveRequests.filter((u) => !u.includes('news.ycombinator.com') && !u.includes('openrouter.ai') && !u.startsWith('chrome-extension://'));
        soft('live smoke made no unexpected requests', external.length === 0, external.slice(0, 5).join(', '));
      });
    } finally {
      await liveCtx.close();
    }
  }

  if (FULL) {
    await scenario('provider-timeout', async () => {
      await configure(ctx, extId, {});
      provider.reset(); provider.setMode('slow');
      const page = await openFixture(ctx, `https://x.com:${port}/feed?tag=SCEN12`);
      await page.waitForTimeout(24000);
      const bars = await barInfo(page);
      check('timeout leaves posts visible', bars.length === 0, `${bars.length} bars`);
      provider.setMode('ok');
    });
  }

  // Provider-failure scenarios each run in their own fresh context: the
  // bounded backoff (5s doubling to 60s) is worker state, so a shared context
  // would let the first failure starve the next scenario. Fresh contexts make
  // each failure mode real, and let the recovery scenario prove production
  // recovery (pause expiry, no resets) in one clean worker.
  await scenario('provider-429-final', async () => {
    const c = await launch({ profileSuffix: '-429' });
    try {
      const id = await extensionId(c);
      await configure(c, id, {});
      provider.reset(); provider.setMode('429');
      const page = await c.newPage();
      await page.goto(`https://x.com:${port}/feed?tag=SCEN8B`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForContent(page);
      await page.waitForTimeout(2500);
      const bars = await barInfo(page);
      check('429 leaves posts visible', bars.length === 0, `${bars.length} bars`);
      // Poll for the pause: under a loaded suite the first calls can take a
      // beat, but a 429 storm must end paused.
      let diag = null;
      for (let i = 0; i < 20; i += 1) {
        diag = await extPage(c, id, 'options.html').then((pg) => pg.evaluate(async () => chrome.runtime.sendMessage({ type: 'getDiagnostics' })));
        if (diag?.paused === true) break;
        await page.waitForTimeout(1000);
      }
      const failureDom = await page
        .evaluate(() => ({
          state: document.readyState,
          articles: document.querySelectorAll('article').length,
          marks: document.querySelectorAll('[data-polymorph-state]').length,
          cards: document.querySelectorAll('polymorph-card').length,
          injected: document.documentElement.hasAttribute('data-polymorph-extension'),
        }))
        .catch(() => ({}));
      check(
        'diagnostics show the provider pause after 429',
        diag?.paused === true,
        `paused=${diag?.paused} calls=${provider.count()} bars=${bars.length} totals=${JSON.stringify(diag?.totals)} dom=${JSON.stringify(failureDom)}`,
      );
    } finally {
      provider.setMode('ok');
      await c.close();
    }
  });

  await scenario('provider-offline-final', async () => {
    const c = await launch({ profileSuffix: '-offline' });
    try {
      const id = await extensionId(c);
      await configure(c, id, {});
      provider.reset(); provider.setMode('offline');
      const page = await c.newPage();
      await page.goto(`https://x.com:${port}/feed?tag=SCEN8C`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForContent(page);
      await page.waitForTimeout(2500);
      const bars = await barInfo(page);
      check('network failure leaves posts visible', bars.length === 0, `${bars.length} bars`);
    } finally {
      provider.setMode('ok');
      await c.close();
    }
  });

  if (FULL) {
    await scenario('backoff-recovery', async () => {
      const c = await launch({ profileSuffix: '-recovery' });
      try {
        const id = await extensionId(c);
        await configure(c, id, {});
        provider.reset(); provider.setMode('429');
        const first = await c.newPage();
        await first.goto(`https://x.com:${port}/feed?tag=SCEN13`);
        await first.reload({ waitUntil: 'domcontentloaded' });
        // Cold-start hardening: many contexts have been created by now, so
        // wait for the content script to touch the DOM before judging state.
        await first
          .waitForFunction(() => document.querySelectorAll('[data-polymorph-state]').length > 0, null, { timeout: 30000, polling: 100 })
          .catch(() => {});
        await first.waitForTimeout(1500);
        let during = null;
        for (let i = 0; i < 24; i += 1) {
          during = await extPage(c, id, 'options.html').then((pg) => pg.evaluate(async () => chrome.runtime.sendMessage({ type: 'getDiagnostics' })));
          if (during?.paused === true) break;
          await first.waitForTimeout(1000);
        }
        const domState = await first.evaluate(() => ({
          articles: document.querySelectorAll('article').length,
          marked: document.querySelectorAll('[data-polymorph-state]').length,
        })).catch(() => ({}));
        check(
          'recovery: paused after the 429 storm',
          during?.paused === true,
          `paused=${during?.paused} calls=${provider.count()} totals=${JSON.stringify(during?.totals)} dom=${JSON.stringify(domState)}`,
        );
        provider.setMode('ok');
        let resumed = false;
        for (let i = 0; i < 40; i += 1) {
          await page_settle(2000);
          const snap = await extPage(c, id, 'options.html').then((pg) => pg.evaluate(async () => chrome.runtime.sendMessage({ type: 'getDiagnostics' })));
          if (snap?.paused === false) { resumed = true; break; }
        }
        check('recovery: pause expires without any reset', resumed === true, `still paused after 80s`);
        const second = await c.newPage();
        await second.goto(`https://x.com:${port}/feed?tag=SCEN13B`);
        await waitForContent(second);
        await waitBars(second, 1, 15000);
        const bars = await barInfo(second);
        check('recovery: posts transform again after the pause', bars.length >= 1, `${bars.length} bars`);
      } finally {
        provider.setMode('ok');
        await c.close();
      }
    });
  }

} finally {
  // Report
  const failed = results.filter((r) => !r.ok && !r.soft);
  const softFails = results.filter((r) => !r.ok && r.soft);
  const report = {
    run: RUN_ID,
    label: LABEL,
    dist: DIST,
    extensionId: extId,
    startedAt: RUN_ID,
    totals: { checks: results.length, failed: failed.length, softFailed: softFails.length },
    results,
    screenshots: shots,
  };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const lines = [
    `# Polymorph QA report — ${LABEL}`,
    ``,
    `- dist: ${DIST}`,
    `- extension id: ${extId}`,
    `- checks: ${results.length} · failed: ${failed.length} · soft-failed: ${softFails.length}`,
    ``,
    `## Failures`,
    ...(failed.length ? failed.map((f) => `- [${f.scenario}] ${f.name} — ${f.detail}`) : ['- none']),
    ``,
    `## Soft failures`,
    ...(softFails.length ? softFails.map((f) => `- [${f.scenario}] ${f.name} — ${f.detail}`) : ['- none']),
    ``,
    `## Screenshots`,
    ...shots.map((s) => `- ${s.name}: ${s.file ?? s.error}`),
  ];
  writeFileSync(join(OUT, 'report.md'), lines.join('\n'));
  console.log(`\nreport: ${join(OUT, 'report.md')}`);
  console.log(`checks=${results.length} failed=${failed.length} soft=${softFails.length}`);
  await ctx.close();
  server.close();
  process.exit(failed.length > 0 ? 1 : 0);
}
