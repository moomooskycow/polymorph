/**
 * Polymorph QA fixture server.
 *
 * Serves, over HTTPS on 127.0.0.1:8443 with a self-signed cert:
 *  - deterministic site fixture pages for x.com / reddit.com / news.ycombinator.com
 *    / youtube.com / gmail.com / fixture.test (host-based routing; the harness
 *    maps these hostnames to 127.0.0.1 with --host-resolver-rules)
 *  - a mock Jev (OpenRouter) endpoint at openrouter.ai/api/alpha/decisions with
 *    switchable response modes
 *  - static passthrough for built extension assets under /dist/* (gallery pages)
 *
 * Everything is labelled synthetic: fixture pages exercise the real extension
 * pipeline, they are NOT live sites.
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const QA_PORT = 8443;
export const QA_ORIGIN = `https://openrouter.ai:${QA_PORT}`;
export const QA_ENDPOINT = `${QA_ORIGIN}/api/alpha/decisions`;

const CERT_DIR = join(homedir(), '.cache', 'polymorph-qa', 'certs');

const HOSTS = [
  'x.com', 'www.x.com', 'twitter.com',
  'reddit.com', 'www.reddit.com', 'old.reddit.com',
  'news.ycombinator.com',
  'youtube.com', 'www.youtube.com',
  'gmail.com', 'mail.google.com',
  'openrouter.ai',
  'fixture.test',
  'localhost', '127.0.0.1',
];

function ensureCert() {
  mkdirSync(CERT_DIR, { recursive: true });
  const key = join(CERT_DIR, 'key.pem');
  const cert = join(CERT_DIR, 'cert.pem');
  if (existsSync(key) && existsSync(cert)) return { key: readFileSync(key), cert: readFileSync(cert) };
  const san = HOSTS.map((h) => `DNS:${h}`).join(',') + ',IP:127.0.0.1';
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '365',
    '-subj', '/CN=polymorph-qa',
    '-addext', `subjectAltName=${san}`,
  ], { stdio: 'ignore' });
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

// ---------------------------------------------------------------------------
// Site fixtures (synthetic DOM modelled on each supported site's structure)
// ---------------------------------------------------------------------------

const X_POSTS = [
  'Outrage bait post number one engineered to provoke: everyone is furious about this.',
  'Calm gardening notes about tomatoes and soil pH, nothing controversial here at all.',
  'Another dunk-style political argument with tribal point scoring and insults.',
  'Short.',
  'A rage-bait hook: you will not believe what happened next and you should be angry.',
  'Neutral book review about nineteenth century railway engineering in Britain.',
  'Unsolicited correction aimed at another user: well actually, the numbers say otherwise.',
  'A long good-faith explainer about how ranked choice voting counts ballots.',
];

function xArticle(tag, i) {
  const text = `FIXTURE_${tag}_${i} ${X_POSTS[i % X_POSTS.length]}`;
  return `<article data-testid="tweet" data-qa="post-${i}">
    <div class="body"><span class="txt">${text}</span></div>
    <button class="like" data-qa="like-${i}">Like</button>
  </article>`;
}

function page(title, body, extra = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 0; background: #f4f2ee; color: #17171a; }
  main { max-width: 600px; margin: 0 auto; padding: 16px; }
  article, shreddit-post, ytd-comment-view-model, .athing { display: block; background: #fff; border: 1px solid #dcd9d2; border-radius: 10px; margin: 10px 0; padding: 12px; }
  .txt { display: block; }
  button { margin-top: 8px; }
</style>${extra}</head>
<body><main id="feed">${body}</main></body></html>`;
}

const PAGES = {
  'openrouter.ai': {
    '/popup-fixture': (tag) => `<!doctype html>
<html><head><title>Polymorph popup fixture</title></head>
<body><main><h1>Polymorph popup fixture (${tag})</h1>
<p>A plain page served on openrouter.ai so the extension popup can read a
real tab URL under its standing host permission.</p></main></body></html>`,
  },
  'x.com': {
    '/feed': (tag) => page('X fixture', X_POSTS.map((_, i) => xArticle(tag, i)).join('\n')),
    '/spa': (tag) => page('X fixture SPA', xArticle(tag, 0) + xArticle(tag, 1), `<script>window.__spa = true;</script>`),
  },
  'reddit.com': {
    '/feed': (tag) => page('Reddit fixture', `
      <shreddit-post data-qa="post-0">FIXTURE_${tag}_0 Outrage-bait headline engineered for maximum anger, everyone furious.</shreddit-post>
      <shreddit-post data-qa="post-1">FIXTURE_${tag}_1 A quiet post about knitting patterns for winter scarves, very calm.</shreddit-post>
      <shreddit-comment data-qa="comment-0">FIXTURE_${tag}_2 A comment with a well-actually correction of another user, unasked for.</shreddit-comment>`),
  },
  'news.ycombinator.com': {
    '/': (tag) => page('HN fixture', `
      <table><tbody>
      <tr class="athing" data-qa="post-0"><td><span class="titleline">FIXTURE_${tag}_0 Rage bait title about how everything is broken and you should be angry</span></td></tr>
      <tr class="athing" data-qa="post-1"><td><span class="titleline">FIXTURE_${tag}_1 Show HN: a small tool for counting railway sleepers (calm, technical)</span></td></tr>
      </tbody></table>`),
  },
  'youtube.com': {
    '/watch': (tag) => page('YouTube fixture', `
      <ytd-comment-view-model data-qa="post-0">FIXTURE_${tag}_0 This comment is pure rage bait designed to start fights in the replies.</ytd-comment-view-model>
      <ytd-comment-view-model data-qa="post-1">FIXTURE_${tag}_1 Genuine question: does anyone know how to repair a bike chain?</ytd-comment-view-model>`),
  },
  'gmail.com': {
    '/mail': (tag) => page('Gmail fixture', `
      <article data-qa="post-0">FIXTURE_${tag}_0 Bank statement for September with account details and balance figures.</article>`),
  },
  'fixture.test': {
    '/generic': (tag) => page('Generic fixture', `
      <article data-qa="post-0">FIXTURE_${tag}_0 A generic article element long enough to pass the minimum length check.</article>
      <article data-qa="post-1">FIXTURE_${tag}_1 Another generic article with enough text to be considered a post.</article>`),
  },
};

function buildFixturePage(host, pathname, tag) {
  const variants = PAGES[host] ?? (host === 'www.x.com' || host === 'twitter.com' ? PAGES['x.com']
    : host === 'www.reddit.com' || host === 'old.reddit.com' ? PAGES['reddit.com']
    : host === 'www.youtube.com' ? PAGES['youtube.com']
    : host === 'mail.google.com' ? PAGES['gmail.com']
    : null);
  if (!variants) return null;
  const builder = variants[pathname] ?? variants['/'] ?? variants['/feed'];
  return builder ? builder(tag) : null;
}

// ---------------------------------------------------------------------------
// Mock Jev provider
// ---------------------------------------------------------------------------

export function createProvider() {
  const state = {
    mode: 'ok', // ok | nomatch | lowprob | 401 | 429 | 500 | malformed | offline | slow
    requests: [],
    slowMs: 21_000,
  };
  function answersFor(body) {
    const answers = {};
    let ids = [];
    try {
      const parsed = JSON.parse(body);
      ids = Object.keys(parsed.questions ?? {});
    } catch {
      ids = [];
    }
    for (const id of ids) {
      if (state.mode === 'nomatch') answers[id] = { choice: 'no_match', probabilities: { match: 0.05 }, confidence: 0.9 };
      else if (state.mode === 'lowprob') answers[id] = { choice: 'match', probabilities: { match: 0.6 }, confidence: 0.9 };
      else answers[id] = { choice: 'match', probabilities: { match: 0.95 }, confidence: 0.9 };
    }
    return { answers };
  }
  return {
    state,
    setMode(mode) { state.mode = mode; },
    reset() { state.requests = []; },
    count() { return state.requests.length; },
    lastBody() { return state.requests.at(-1)?.body ?? ''; },
    async handle(req, res, body) {
      state.requests.push({ at: Date.now(), url: req.url, body: body.toString('utf8') });
      const mode = state.mode;
      if (mode === '401') { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthorized"}'); return; }
      if (mode === '429') { res.writeHead(429, { 'content-type': 'application/json' }); res.end('{"error":"rate limited"}'); return; }
      if (mode === '500') { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"boom"}'); return; }
      if (mode === 'malformed') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"not_answers": true}'); return; }
      if (mode === 'offline') { req.socket.destroy(); return; }
      if (mode === 'slow') { await new Promise((r) => setTimeout(r, state.slowMs)); }
      const payload = JSON.stringify(answersFor(body));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(payload);
    },
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function startServer({ distDir, port = QA_PORT } = {}) {
  const provider = createProvider();
  const { key, cert } = ensureCert();
  const server = createServer({ key, cert }, (req, res) => {
    const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
    const url = new URL(req.url ?? '/', `https://${req.headers.host}`);

    if (host === 'openrouter.ai') {
      // GET pages (non-API) are fixture pages: the popup test needs a real tab
      // whose URL the extension can read, and openrouter.ai is the one host
      // with a standing host permission.
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const html = buildFixturePage('openrouter.ai', url.pathname, url.searchParams.get('tag') ?? 'BASE');
        if (html !== null) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => { void provider.handle(req, res, Buffer.from(body)); });
      return;
    }

    // Static passthrough of built extension assets (gallery/icon renders).
    if (url.pathname.startsWith('/dist/') && distDir) {
      const rel = url.pathname.slice('/dist/'.length);
      const file = join(distDir, rel);
      try {
        const data = readFileSync(file);
        const type = file.endsWith('.svg') ? 'image/svg+xml'
          : file.endsWith('.png') ? 'image/png'
          : file.endsWith('.css') ? 'text/css'
          : file.endsWith('.js') ? 'text/javascript'
          : 'application/octet-stream';
        res.writeHead(200, { 'content-type': type });
        res.end(data);
      } catch {
        res.writeHead(404); res.end('missing');
      }
      return;
    }

    const tag = url.searchParams.get('tag') ?? 'BASE';
    const html = buildFixturePage(host, url.pathname, tag);
    if (html !== null) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(`no fixture for ${host}${url.pathname}`);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, provider, port: QA_PORT });
    });
  });
}
