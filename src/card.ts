/** Custom element that hosts the replacement card's shadow DOM. */
export const CARD_TAG = 'polymorph-card';
/** Marks the table-row wrapper used when a post is a `<tr>` (HN). */
export const MOUNT_ATTR = 'data-polymorph-mount';

/** What the content script resolved for this card (blob/data URL, no names). */
export interface CardMedia {
  url: string;
  mime: string;
  /** True when an animated GIF was frozen to a still frame. */
  frozen: boolean;
}

const CARD_STYLE = `
:host {
  display: block;
  margin: 6px 0;
  max-width: 480px;
  contain: content;
  color-scheme: light dark;
}
.card {
  border: 1px solid #d9d5cc;
  border-radius: 10px;
  overflow: hidden;
  background: #fbfaf7;
  color: #1d1c1a;
  font: 13px/1.45 ui-sans-serif, system-ui, sans-serif;
}
.art {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 104px;
  max-height: 120px;
  padding: 6px 10px 0;
}
.art:empty { display: none; }
.art img { display: block; max-height: 100%; max-width: 100%; object-fit: contain; }
.card.plain .art { display: none; }
.body { display: flex; align-items: center; gap: 10px; padding: 9px 10px; }
.text { flex: 1; min-width: 0; }
.caption { margin: 0; font-weight: 600; }
.meta { margin: 2px 0 0; color: #6b6862; font-size: 12px; }
.show {
  flex: none;
  font: inherit;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  border-radius: 999px;
  padding: 4px 12px;
  cursor: pointer;
}
.show:hover { background: rgba(127, 127, 127, 0.15); }
.show:focus-visible { outline: 2px solid #2f6f4f; outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  .card { background: #23221f; color: #ece9e2; border-color: #3a3833; }
  .meta { color: #a09c93; }
  .show:focus-visible { outline-color: #7dbb96; }
}
`;

export interface CardView {
  element: HTMLElement;
  showOriginal: HTMLButtonElement;
  setMedia(media: CardMedia | null): void;
  setReducedMotion(reduced: boolean): void;
}

/**
 * US-014: bounded replacement card. With user media it draws a height-capped
 * image; with an empty library it is the compact collapse card. No filenames
 * or sizes are rendered into the page.
 */
export function buildCard(options: {
  ruleName: string;
  media: CardMedia | null;
  reducedMotion?: boolean;
}): CardView {
  const element = document.createElement(CARD_TAG);
  element.setAttribute('role', 'group');
  element.setAttribute('data-polymorph-card', '');

  const shadow = element.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CARD_STYLE;

  const card = document.createElement('div');
  card.className = 'card';
  const art = document.createElement('div');
  art.className = 'art';
  const body = document.createElement('div');
  body.className = 'body';
  const text = document.createElement('div');
  text.className = 'text';
  const caption = document.createElement('p');
  caption.className = 'caption';
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `Replaced by “${options.ruleName}”`;
  const showOriginal = document.createElement('button');
  showOriginal.type = 'button';
  showOriginal.className = 'show';
  showOriginal.textContent = 'Show original';
  showOriginal.setAttribute('aria-label', `Show the original post replaced by the rule ${options.ruleName}`);

  text.append(caption, meta);
  body.append(text, showOriginal);
  card.append(art, body);
  shadow.append(style, card);

  const setMedia = (media: CardMedia | null): void => {
    art.replaceChildren();
    if (media === null) {
      card.classList.add('plain');
      caption.textContent = `Hidden by rule “${options.ruleName}”`;
      element.setAttribute('aria-label', `Post hidden by rule ${options.ruleName}`);
      return;
    }
    card.classList.remove('plain');
    const image = document.createElement('img');
    image.src = media.url;
    image.alt = '';
    image.decoding = 'async';
    image.setAttribute('data-media-mime', media.mime);
    image.setAttribute('data-media-frozen', String(media.frozen));
    art.append(image);
    art.setAttribute('role', 'img');
    art.setAttribute('aria-label', `Replacement media for the rule ${options.ruleName}`);
    caption.textContent = media.mime === 'image/gif'
      ? media.frozen
        ? 'Your GIF is paused for reduced motion.'
        : 'Your GIF replaces this post.'
      : 'Your image replaces this post.';
    element.setAttribute(
      'aria-label',
      `Post replaced with your media by rule ${options.ruleName}.`,
    );
  };

  setMedia(options.media);
  element.setAttribute('data-reduced-motion', String(options.reducedMotion === true));

  return {
    element,
    showOriginal,
    setMedia,
    setReducedMotion: (reduced: boolean) => {
      element.setAttribute('data-reduced-motion', String(reduced));
    },
  };
}

/** Mounts the card before the post, using a table row when the post is a `<tr>`. */
export function mountElement(post: HTMLElement, element: HTMLElement): HTMLElement | null {
  const parent = post.parentNode;
  if (parent === null) return null;
  if (post.tagName === 'TR' && parent instanceof HTMLTableSectionElement) {
    const row = document.createElement('tr');
    row.setAttribute(MOUNT_ATTR, 'row');
    const cell = document.createElement('td');
    const columns = post.querySelectorAll('td').length;
    if (columns > 1) cell.colSpan = columns;
    cell.append(element);
    row.append(cell);
    parent.insertBefore(row, post);
    return row;
  }
  parent.insertBefore(element, post);
  return element;
}

export function unmountElement(element: HTMLElement): void {
  const wrapper = element.closest(`tr[${MOUNT_ATTR}]`);
  if (wrapper !== null) wrapper.remove();
  else element.remove();
}

const previousDisplay = new WeakMap<HTMLElement, string>();

/** Hides the post in place and mounts the card. */
export function transformPost(post: HTMLElement, view: CardView): boolean {
  if (post.parentNode === null) return false;
  previousDisplay.set(post, post.style.display);
  post.style.display = 'none';
  mountElement(post, view.element);
  return true;
}

/** US-008: "Show original" removes the card and restores the post. */
export function restorePost(post: HTMLElement, view: CardView): void {
  unmountElement(view.element);
  post.style.display = previousDisplay.get(post) ?? '';
  previousDisplay.delete(post);
}

export function isCardNode(node: Node): boolean {
  return node instanceof Element && node.tagName.toLowerCase() === CARD_TAG;
}

export function isInsideCard(node: Node): boolean {
  return node instanceof Element && node.closest(CARD_TAG) !== null;
}