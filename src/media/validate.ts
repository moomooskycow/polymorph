import {
  MEDIA_MAX_FILE_BYTES,
  MEDIA_MAX_FILES,
  MEDIA_MAX_TOTAL_BYTES,
  type MediaKind,
} from './types';

export interface SniffedMedia {
  kind: MediaKind;
  mime: string;
}

function startsWith(bytes: Uint8Array, offset: number, values: readonly number[]): boolean {
  if (bytes.length < offset + values.length) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (bytes[offset + index] !== values[index]) return false;
  }
  return true;
}

/**
 * Magic-byte sniffing. Anything that is not a known raster image or GIF is
 * rejected, which is what keeps SVG and HTML out of the library.
 */
export function sniffMediaType(bytes: Uint8Array): SniffedMedia | null {
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'png', mime: 'image/png' };
  }
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) {
    return { kind: 'jpeg', mime: 'image/jpeg' };
  }
  if (
    startsWith(bytes, 0, [0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { kind: 'gif', mime: 'image/gif' };
  }
  if (startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return { kind: 'webp', mime: 'image/webp' };
  }
  return null;
}

export type ValidationIssue =
  | 'empty'
  | 'too_large'
  | 'unsupported'
  | 'corrupt'
  | 'library_full'
  | 'quota_exceeded';

export interface LibraryCapacity {
  count: number;
  totalBytes: number;
}

export type CandidateResult =
  | { ok: true; media: SniffedMedia }
  | { ok: false; issue: ValidationIssue; message: string };

export function issueMessage(issue: ValidationIssue): string {
  switch (issue) {
    case 'empty':
      return 'The file is empty.';
    case 'too_large':
      return `Too large; the limit is ${Math.round(MEDIA_MAX_FILE_BYTES / (1024 * 1024))} MB per file.`;
    case 'unsupported':
      return 'Unsupported format. PNG, JPEG, WebP, and GIF only; SVG and HTML are not allowed.';
    case 'corrupt':
      return 'The file could not be decoded; it may be corrupt or truncated.';
    case 'library_full':
      return `The library is full (${MEDIA_MAX_FILES} files). Remove some first.`;
    case 'quota_exceeded':
      return `The library would exceed ${Math.round(MEDIA_MAX_TOTAL_BYTES / (1024 * 1024))} MB. Remove some first.`;
  }
}

/**
 * Pure pre-store validation. Decodability (corrupt/truncated) is checked in
 * the worker after this, because it needs the browser's image decoder.
 */
export function validateCandidate(args: {
  bytes: Uint8Array;
  library: LibraryCapacity;
}): CandidateResult {
  const { bytes, library } = args;
  if (bytes.length === 0) return { ok: false, issue: 'empty', message: issueMessage('empty') };
  if (bytes.length > MEDIA_MAX_FILE_BYTES) {
    return { ok: false, issue: 'too_large', message: issueMessage('too_large') };
  }
  const media = sniffMediaType(bytes);
  if (media === null) {
    return { ok: false, issue: 'unsupported', message: issueMessage('unsupported') };
  }
  if (library.count >= MEDIA_MAX_FILES) {
    return { ok: false, issue: 'library_full', message: issueMessage('library_full') };
  }
  if (library.totalBytes + bytes.length > MEDIA_MAX_TOTAL_BYTES) {
    return { ok: false, issue: 'quota_exceeded', message: issueMessage('quota_exceeded') };
  }
  return { ok: true, media };
}