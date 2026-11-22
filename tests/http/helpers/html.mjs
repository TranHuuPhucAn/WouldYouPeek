import { JSDOM } from "jsdom";

/** Parse the real server response without executing scripts or fetching assets.
 * @param {string} html
 * @param {string} [url]
 * @returns {Document}
 */
export function parseHtml(html, url) {
  return new JSDOM(html, url ? { url } : undefined).window.document;
}
