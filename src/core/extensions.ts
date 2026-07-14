import type { ExtensionRow } from "./intermediate.ts";

// Extensions can't be migrated as data (they're installed programs; state is
// keyed to per-browser extension IDs). We export the LIST + store links so
// reinstalling is one click each. Browsers block silent install by design.

/** Chromium: extensions live in `Preferences` / `Secure Preferences` under
 *  extensions.settings, keyed by the 32-char store ID. */
export function chromiumExtensions(prefs: any, securePrefs: any): ExtensionRow[] {
  const settings = {
    ...(prefs?.extensions?.settings ?? {}),
    ...(securePrefs?.extensions?.settings ?? {}),
  };
  const out: ExtensionRow[] = [];
  for (const [id, v] of Object.entries<any>(settings)) {
    const m = v?.manifest;
    if (!m || m.theme) continue; // skip themes
    if (id.length !== 32) continue; // real Web Store IDs are 32 chars
    if (v.was_installed_by_default === true) continue; // skip Google's bundled components
    const fromStore = v.from_webstore === true || v.location === 1;
    if (!fromStore) continue; // skip component/unpacked/external
    let name: string = m.name ?? id;
    if (name.startsWith("__MSG_")) name = id; // localized name we can't resolve cheaply
    out.push({
      id,
      name,
      storeUrl: `https://chromewebstore.google.com/detail/${id}`,
      enabled: v.state === 1,
    });
  }
  return out;
}

/** Firefox: `extensions.json` -> addons[]. IDs are GUIDs (not AMO slugs), so
 *  the store link is an AMO search by name — reliable enough to find it. */
export function firefoxExtensions(extJson: any): ExtensionRow[] {
  const out: ExtensionRow[] = [];
  for (const a of extJson?.addons ?? []) {
    if (a.type !== "extension") continue;
    if (a.location && a.location !== "app-profile") continue; // user-installed only
    const name: string = a.defaultLocale?.name ?? a.id;
    out.push({
      id: a.id,
      name,
      storeUrl: `https://addons.mozilla.org/firefox/search/?q=${encodeURIComponent(name)}`,
      enabled: a.active === true && !a.userDisabled,
    });
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function extensionsToHtml(rows: ExtensionRow[]): string {
  const items = rows
    .map((r) => `  <li><a href="${esc(r.storeUrl)}">${esc(r.name)}</a>${r.enabled ? "" : " (disabled)"}</li>`)
    .join("\n");
  return (
    `<!DOCTYPE html>\n<meta charset="utf-8">\n<title>Extensions to reinstall</title>\n` +
    `<h1>Extensions (${rows.length})</h1>\n` +
    `<p>Click each to open its store page, then Install. Browsers don't allow silent install.</p>\n` +
    `<ul>\n${items}\n</ul>\n`
  );
}
