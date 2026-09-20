import { bytesToBase64 } from './bytes';

/**
 * Browser-only decode + thumbnail helpers, used by the service worker.
 * IndexedDB stores the original bytes; the thumbnail is a small data URL so
 * the options grid never loads full-size assets for previews.
 */
export async function decodeRaster(
  bytes: Uint8Array,
  mime: string,
): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }));
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export async function makeThumbnail(
  bytes: Uint8Array,
  mime: string,
  width: number,
  height: number,
): Promise<string | null> {
  const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }));
  const sourceWidth = width > 0 ? width : bitmap.width;
  const sourceHeight = height > 0 ? height : bitmap.height;
  const scale = Math.min(1, 160 / Math.max(sourceWidth, sourceHeight, 1));
  const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
  const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const context = canvas.getContext('2d');
  if (context === null) {
    bitmap.close();
    return null;
  }
  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();
  let output: Blob;
  try {
    output = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
  } catch {
    output = await canvas.convertToBlob({ type: 'image/png' });
  }
  const encoded = bytesToBase64(new Uint8Array(await output.arrayBuffer()));
  return `data:${output.type};base64,${encoded}`;
}