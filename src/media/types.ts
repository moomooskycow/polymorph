/** Supported user media types. SVG/HTML are deliberately absent. */
export type MediaKind = 'png' | 'jpeg' | 'gif' | 'webp';

/** Metadata the options page and diagnostics may see. Never file contents. */
export interface MediaAssetMeta {
  id: string;
  kind: MediaKind;
  mime: string;
  size: number;
  addedAt: number;
  width: number;
  height: number;
  /** Small data-URL preview for the options grid only. */
  thumb: string | null;
}

export interface MediaAsset extends MediaAssetMeta {
  bytes: Uint8Array;
}

/** Documented quotas (shown in the options UI). */
export const MEDIA_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MEDIA_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const MEDIA_MAX_FILES = 200;

export interface MediaUsage {
  count: number;
  totalBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

/** US-014: exact options empty-state copy. */
export const MEDIA_EMPTY_COPY =
  'Add images or GIFs to replace filtered posts. Without images, posts are collapsed.';

export function emptyUsage(): MediaUsage {
  return {
    count: 0,
    totalBytes: 0,
    maxFiles: MEDIA_MAX_FILES,
    maxTotalBytes: MEDIA_MAX_TOTAL_BYTES,
    maxFileBytes: MEDIA_MAX_FILE_BYTES,
  };
}