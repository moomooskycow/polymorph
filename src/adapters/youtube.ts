import type { Adapter } from './index';

/**
 * YouTube comment threads and video cards. Player chrome is not a post and is
 * excluded both by selector choice and by an explicit skip list.
 */
export const youtubeAdapter: Adapter = {
  id: 'youtube',
  selectors: [
    'ytd-comment-thread-renderer',
    'ytd-comment-view-model',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
  ],
  skip: ['#player', 'ytd-player', '#masthead', 'ytd-watch-metadata', 'ytd-engagement-panel-section-list-renderer'],
};