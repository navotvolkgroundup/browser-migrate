import type { BookmarkNode } from "./intermediate.ts";

// The one universal bookmark format: every browser on the target list
// imports Netscape bookmark HTML. This is the safe migration path for M1 —
// no proprietary profile writing, so no risk of corrupting a live browser.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render(nodes: BookmarkNode[], indent: string): string {
  let out = `${indent}<DL><p>\n`;
  for (const node of nodes) {
    if (node.type === "url") {
      const ts = node.addedMs ? ` ADD_DATE="${Math.floor(node.addedMs / 1000)}"` : "";
      out += `${indent}    <DT><A HREF="${esc(node.url)}"${ts}>${esc(node.name)}</A>\n`;
    } else {
      out += `${indent}    <DT><H3>${esc(node.name)}</H3>\n`;
      out += render(node.children, indent + "    ");
    }
  }
  out += `${indent}</DL><p>\n`;
  return out;
}

import type { TabRow } from "./intermediate.ts";

/** Open tabs as a plain links page — restore by opening it and clicking, since
 *  no cross-browser "reopen these tabs" format exists. */
export function tabsToHtml(tabs: TabRow[]): string {
  const items = tabs
    .map((t) => `  <li><a href="${esc(t.url)}">${esc(t.title || t.url)}</a></li>`)
    .join("\n");
  return `<!DOCTYPE html>\n<meta charset="utf-8">\n<title>Open tabs</title>\n<h1>Open tabs (${tabs.length})</h1>\n<ul>\n${items}\n</ul>\n`;
}

export function toNetscapeHtml(bookmarks: BookmarkNode[]): string {
  return (
    `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n` +
    `<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n` +
    `<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n` +
    render(bookmarks, "")
  );
}
