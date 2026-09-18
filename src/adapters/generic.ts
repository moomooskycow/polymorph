import type { Adapter } from './index';

/** Any other allowlisted host: articles only, and never page furniture. */
export const genericAdapter: Adapter = {
  id: 'generic',
  selectors: ['article', '[role="article"]'],
  skip: ['nav', 'header', 'footer', 'aside', 'form', '[contenteditable]', 'button'],
};