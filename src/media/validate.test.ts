import { describe, expect, it } from 'vitest';
import {
  issueMessage,
  sniffMediaType,
  validateCandidate,
} from './validate';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF87 = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0]);
const GIF89 = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0,
]);
const enc = new TextEncoder();

describe('US-014 media validation', () => {
  it('US-014 sniffs PNG, JPEG, GIF (87a/89a), and WebP by magic bytes', () => {
    expect(sniffMediaType(PNG)).toEqual({ kind: 'png', mime: 'image/png' });
    expect(sniffMediaType(JPEG)).toEqual({ kind: 'jpeg', mime: 'image/jpeg' });
    expect(sniffMediaType(GIF87)).toEqual({ kind: 'gif', mime: 'image/gif' });
    expect(sniffMediaType(GIF89)).toEqual({ kind: 'gif', mime: 'image/gif' });
    expect(sniffMediaType(WEBP)).toEqual({ kind: 'webp', mime: 'image/webp' });
  });

  it('US-014 rejects SVG, HTML, and unknown bytes as unsupported', () => {
    for (const bytes of [
      enc.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      enc.encode('<!doctype html><html><body>hi</body></html>'),
      enc.encode('not an image at all'),
    ]) {
      const result = validateCandidate({ bytes, library: { count: 0, totalBytes: 0 } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issue).toBe('unsupported');
        expect(result.message).toMatch(/svg|html/i);
      }
    }
  });

  it('US-014 rejects empty and oversized files with specific messages', () => {
    const empty = validateCandidate({ bytes: new Uint8Array(0), library: { count: 0, totalBytes: 0 } });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.issue).toBe('empty');

    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG.subarray(0, 8));
    const oversized = validateCandidate({ bytes: big, library: { count: 0, totalBytes: 0 } });
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.issue).toBe('too_large');
      expect(oversized.message).toContain('5 MB');
    }
  });

  it('US-014 enforces the file-count and total-size quotas', () => {
    const full = validateCandidate({
      bytes: PNG,
      library: { count: 200, totalBytes: 0 },
    });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.issue).toBe('library_full');

    const heavy = validateCandidate({
      bytes: PNG,
      library: { count: 1, totalBytes: 100 * 1024 * 1024 },
    });
    expect(heavy.ok).toBe(false);
    if (!heavy.ok) {
      expect(heavy.issue).toBe('quota_exceeded');
      expect(heavy.message).toContain('100 MB');
    }

    const fine = validateCandidate({ bytes: PNG, library: { count: 3, totalBytes: 1024 } });
    expect(fine.ok).toBe(true);
    if (fine.ok) expect(fine.media.kind).toBe('png');
  });

  it('US-014 every rejection issue has a human message', () => {
    for (const issue of ['empty', 'too_large', 'unsupported', 'corrupt', 'library_full', 'quota_exceeded'] as const) {
      expect(issueMessage(issue).length).toBeGreaterThan(5);
    }
  });
});