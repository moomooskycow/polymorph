import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './bytes';

describe('US-014 media byte transport', () => {
  it('US-014 round-trips bytes, including multi-chunk payloads', () => {
    const small = Uint8Array.from([0, 1, 2, 253, 254, 255]);
    expect(base64ToBytes(bytesToBase64(small))).toEqual(small);

    const large = new Uint8Array(200_000);
    for (let index = 0; index < large.length; index += 1) large[index] = index % 251;
    const roundTripped = base64ToBytes(bytesToBase64(large));
    expect(roundTripped.length).toBe(large.length);
    expect(roundTripped[0]).toBe(large[0]);
    expect(roundTripped[199_999]).toBe(large[199_999]);
  });

  it('US-014 handles empty input', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
    expect(base64ToBytes('')).toEqual(new Uint8Array(0));
  });
});