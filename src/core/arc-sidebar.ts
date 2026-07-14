import type { BookmarkNode } from "./intermediate.ts";

// Arc is Chromium-engine but stores bookmarks/pinned tabs in a bespoke,
// UNDOCUMENTED `StorableSidebar.json` (a spaces/containers model), not the
// standard `Bookmarks` file. History is still the standard Chromium DB.
//
// VERIFIED against a real Arc profile: `sidebar.containers[].items` interleaves
// id-strings and item-objects; tab objects carry `data.tab.savedURL` /
// `.savedTitle` (itemContainer objects are spaces/folders, skipped). We extract
// tabs as a flat bookmark list and drop non-portable schemes (chrome-extension:,
// about:, chrome:). Folder/space structure is intentionally flattened.
const SKIP_SCHEMES = ["chrome-extension:", "about:", "chrome:"];

export function parseArcBookmarks(json: any): BookmarkNode[] {
  const out: BookmarkNode[] = [];
  const seen = new Set<string>();
  const containers = json?.sidebar?.containers ?? [];
  for (const c of containers) {
    const items = c?.items;
    if (!Array.isArray(items)) continue;
    for (const el of items) {
      if (!el || typeof el !== "object") continue;
      const tab = el.data?.tab;
      const url = tab?.savedURL;
      if (typeof url !== "string" || !url || seen.has(url)) continue;
      if (SKIP_SCHEMES.some((s) => url.startsWith(s))) continue; // not portable to another browser
      seen.add(url);
      out.push({ type: "url", name: (tab.savedTitle as string) || url, url });
    }
  }
  return out;
}
