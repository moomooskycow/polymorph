/**
 * Parses bundled SVG text into an element for inline rendering. This is the
 * only way the extension renders art: no network, no `img` URLs, and DOMParser
 * is not blocked by page Trusted Types policies.
 */
export function svgElement(svgText: string): SVGElement | null {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root === null || root.tagName.toLowerCase() !== 'svg') return null;
  return document.importNode(root, true) as unknown as SVGElement;
}