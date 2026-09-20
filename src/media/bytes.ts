/**
 * Base64 transport helpers. Chrome extension messaging JSON-serializes
 * payloads, so binary bytes cross contexts as base64 strings and become
 * local Blobs/ArrayBuffers again on the other side. Chunked to keep the
 * call stack bounded for multi-megabyte files.
 */
const CHUNK = 0x8000;

function toBinaryString(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += CHUNK) {
    const slice = bytes.subarray(index, index + CHUNK);
    result += String.fromCharCode(...slice);
  }
  return result;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const binary = toBinaryString(bytes);
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(binary, 'binary').toString('base64');
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = typeof atob === 'function' ? atob(value) : Buffer.from(value, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}