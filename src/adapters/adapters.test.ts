import { describe, expect, it } from 'vitest';
import { ADAPTERS, adapterForHost, collectPosts, visibleText } from './index';

const LONG = 'This fixture post body is comfortably longer than forty visible characters.';

function render(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe('US-002 adapters own what a post is', () => {
  it('US-002 maps allowlisted hosts to their adapter', () => {
    expect(adapterForHost('x.com').id).toBe('x');
    expect(adapterForHost('www.x.com').id).toBe('x');
    expect(adapterForHost('twitter.com').id).toBe('x');
    expect(adapterForHost('old.reddit.com').id).toBe('reddit');
    expect(adapterForHost('news.ycombinator.com').id).toBe('hn');
    expect(adapterForHost('m.youtube.com').id).toBe('youtube');
    expect(adapterForHost('example.com').id).toBe('generic');
    expect(adapterForHost('x.com.evil.example').id).toBe('generic');
    expect(adapterForHost('').id).toBe('generic');
  });

  it('US-002 X adapter is the contract selector and finds tweets only', () => {
    expect(ADAPTERS.x.selectors).toEqual(['article[data-testid="tweet"]']);
    const root = render(`
      <article data-testid="tweet">${LONG}</article>
      <article data-testid="tweet">${LONG} two</article>
      <div data-testid="tweet">${LONG} not an article</div>
      <article data-testid="tweet">too short</article>
    `);
    const posts = collectPosts(root, ADAPTERS.x);
    expect(posts).toHaveLength(2);
    expect(posts.every((post) => post.tagName.toLowerCase() === 'article')).toBe(true);
  });

  it('US-002 Reddit adapter finds shreddit posts, comments, and old-reddit things, without nesting', () => {
    const root = render(`
      <shreddit-post>${LONG}<shreddit-comment>${LONG} comment</shreddit-comment></shreddit-post>
      <shreddit-comment>${LONG} standalone comment</shreddit-comment>
      <div class="thing">${LONG} old reddit</div>
      <div class="thing morechildren">more comments</div>
    `);
    const posts = collectPosts(root, ADAPTERS.reddit);
    expect(posts.map((post) => post.tagName.toLowerCase())).toEqual([
      'shreddit-post',
      'shreddit-comment',
      'div',
    ]);
    expect(posts[0]?.querySelector('shreddit-comment')).not.toBeNull();
  });

  it('US-002 HN adapter finds athing rows and comments', () => {
    const root = render(`
      <table>
        <tr class="athing" id="1"><td class="title">${LONG}</td></tr>
        <tr class="athing comtr" id="2"><td>${LONG} comment</td></tr>
        <tr class="spacer"></tr>
      </table>
    `);
    const posts = collectPosts(root, ADAPTERS.hn);
    expect(posts).toHaveLength(2);
    expect(posts.map((post) => post.id)).toEqual(['1', '2']);
  });

  it('US-002 YouTube adapter finds comments and cards but never player chrome', () => {
    const root = render(`
      <div id="player">
        <ytd-video-renderer>${LONG} inside player</ytd-video-renderer>
      </div>
      <ytd-comment-thread-renderer>${LONG}<ytd-comment-view-model>${LONG} reply</ytd-comment-view-model></ytd-comment-thread-renderer>
      <ytd-rich-item-renderer>${LONG} card</ytd-rich-item-renderer>
    `);
    const posts = collectPosts(root, ADAPTERS.youtube);
    expect(posts.map((post) => post.tagName.toLowerCase())).toEqual([
      'ytd-comment-thread-renderer',
      'ytd-rich-item-renderer',
    ]);
    expect(posts.some((post) => post.closest('#player') !== null)).toBe(false);
  });

  it('US-002 generic adapter takes articles but skips page furniture', () => {
    const root = render(`
      <nav><article>${LONG} in nav</article></nav>
      <header><article>${LONG} in header</article></header>
      <footer><article>${LONG} in footer</article></footer>
      <aside><article>${LONG} in aside</article></aside>
      <form><article>${LONG} in form</article></form>
      <div contenteditable="true"><article>${LONG} editable</article></div>
      <article>${LONG} plain</article>
      <section role="article">${LONG} role article</section>
      <article>too short</article>
    `);
    const posts = collectPosts(root, ADAPTERS.generic);
    expect(posts).toHaveLength(2);
    expect(posts.map((post) => post.textContent)).toEqual([
      `${LONG} plain`,
      `${LONG} role article`,
    ]);
  });

  it('US-002 visibleText collapses whitespace and short posts are skipped', () => {
    const root = render(`<article>  one
      two   three </article>`);
    const article = root.querySelector('article');
    expect(article).not.toBeNull();
    expect(visibleText(article!)).toBe('one two three');
    expect(collectPosts(root, ADAPTERS.generic)).toHaveLength(0);
    expect(collectPosts(render(`<article>${'x'.repeat(39)}</article>`), ADAPTERS.generic)).toHaveLength(0);
    expect(collectPosts(render(`<article>${'x'.repeat(40)}</article>`), ADAPTERS.generic)).toHaveLength(1);
  });
});