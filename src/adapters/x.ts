import type { Adapter } from './index';

/** X posts. Twitter DOM reuses the same test id on x.com. */
export const xAdapter: Adapter = {
  id: 'x',
  selectors: ['article[data-testid="tweet"]'],
};