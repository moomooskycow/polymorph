/**
 * OpenRouter key storage. Only the background service worker imports this
 * module. US-001: the key lives in chrome.storage.local and is never injected
 * into a page; options and popup only ever see `hasKey` booleans.
 */
const KEY_STORAGE = 'openrouterKey';

export async function loadKey(): Promise<string> {
  const raw = await chrome.storage.local.get(KEY_STORAGE);
  const value = raw[KEY_STORAGE];
  return typeof value === 'string' ? value.trim() : '';
}

export async function saveKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [KEY_STORAGE]: key.trim() });
}

export async function clearKey(): Promise<void> {
  await chrome.storage.local.remove(KEY_STORAGE);
}

export async function hasKey(): Promise<boolean> {
  return (await loadKey()).length > 0;
}