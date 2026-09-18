import type { Adapter } from './index';

/** New Reddit custom elements plus old Reddit's `.thing` rows. */
export const redditAdapter: Adapter = {
  id: 'reddit',
  selectors: ['shreddit-post', 'shreddit-comment', '.thing'],
  skip: ['.morechildren', 'nav', 'header', 'footer'],
};