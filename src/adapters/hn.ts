import type { Adapter } from './index';

/** Hacker News story rows and comment rows. */
export const hnAdapter: Adapter = {
  id: 'hn',
  selectors: ['.athing'],
  skip: ['nav', 'footer'],
};