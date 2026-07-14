import type { BookmarkNode } from "./intermediate.ts";

// Arc is Chromium-engine but stores bookmarks/pinned tabs in a bespoke,
// UNDOCUMENTED `StorableSidebar.json` (a spaces/containers model), not the
// standard `Bookmarks` file. History is still the standard Chromium DB.
//
// ponytail / HONESTY: this parser is written from community reverse-engineering
// of the format and is NOT verified against a real Arc profile (Arc was not
// installed in the dev environment — see issue #1). It extracts pinned
// items/tabs (objects with data.tab.savedURL) as a flat bookmark list. Folder
// structure and space grouping are intentionally not reconstructed until this
// can be validated against real data.

export function parseArcBookmarks(json: any): BookmarkNode[] {
  const out: BookmarkNode[] = [];
  const seen = new Set<string>();
  const containers = json?.sidebar?.containers ?? [];
  for (const c of containers) {
    const items = c?.items;
    if (!Array.isArray(items)) continue;
    // `items` interleaves id-strings and item-objects; we only want objects.
    for (const el of items) {
      if (!el || typeof el !== "object") continue;
      const tab = el.data?.tab;
      const url = tab?.savedURL;
      if (typeof url === "string" && url && !seen.has(url)) {
        seen.add(url);
        out.push({ type: "url", name: (tab.savedTitle as string) || url, url });
      }
    }
  }
  return out;
}
