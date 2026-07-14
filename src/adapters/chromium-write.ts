import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { BookmarkNode } from "../core/intermediate.ts";

// Writing a Chromium `Bookmarks` file Chrome will accept means reproducing its
// integrity checks:
//   1. A `checksum` field: MD5 over a fixed traversal (bookmark_codec.cc).
//   2. A MAC in `Local State` (protection.macs.bookmarks) keyed by a per-install
//      seed we cannot reproduce. We STRIP that entry so Chrome recomputes it on
//      next launch instead of flagging tampering and resetting bookmarks.
//
// ponytail: known ceiling — MAC stripping + checksum is the pragmatic path used
// by bookmark-import tools; Chrome's exact reset behavior is version-dependent.
// This is why every write goes through backup-before-write. Live-Chrome
// acceptance across versions is a manual spike, not something we can unit-test.
// The checksum algorithm itself IS verified against a real Bookmarks file.

const URL_TYPE = "url";
const FOLDER_TYPE = "folder";

function md5Update(hash: ReturnType<typeof createHash>, node: any) {
  hash.update(String(node.id));
  hash.update(Buffer.from(String(node.name ?? ""), "utf16le")); // title is UTF-16
  if (node.type === "url") {
    hash.update(URL_TYPE);
    hash.update(String(node.url ?? ""));
  } else {
    hash.update(FOLDER_TYPE);
    for (const child of node.children ?? []) md5Update(hash, child);
  }
}

/** Compute the checksum over a parsed Bookmarks object's roots, in Chrome's order. */
export function computeChecksum(roots: Record<string, any>): string {
  const hash = createHash("md5");
  for (const key of ["bookmark_bar", "other", "synced"]) {
    if (roots[key]) md5Update(hash, roots[key]);
  }
  return hash.digest("hex");
}

/** Verify the algorithm: recompute a real Bookmarks file's checksum and compare. */
export function verifyAgainstFile(bookmarksPath: string): { ok: boolean; stored: string; computed: string } {
  const json = JSON.parse(readFileSync(bookmarksPath, "utf8"));
  const stored = json.checksum ?? "";
  const computed = computeChecksum(json.roots ?? {});
  return { ok: stored === computed, stored, computed };
}

// --- writing --------------------------------------------------------------

function toChromeNode(node: BookmarkNode, nextId: () => string): any {
  if (node.type === "url") {
    return {
      id: nextId(),
      type: "url",
      name: node.name,
      url: node.url,
      date_added: node.addedMs
        ? String((node.addedMs + 11644473600000) * 1000) // Unix ms → Chromium µs
        : "0",
    };
  }
  return {
    id: nextId(),
    type: "folder",
    name: node.name,
    children: node.children.map((c) => toChromeNode(c, nextId)),
  };
}

/**
 * Write bookmarks into a Chromium profile dir. Assumes caller already backed up
 * and confirmed the browser is not running.
 */
export function writeBookmarks(profileDir: string, nodes: BookmarkNode[]): void {
  let counter = 3; // 1/2/3 reserved for permanent roots
  const nextId = () => String(++counter + 1);

  const bookmarkBar = {
    id: "1",
    type: "folder",
    name: "Bookmarks bar",
    children: nodes.flatMap((n) => (n.type === "folder" && n.name === "Bookmarks bar" ? n.children : [n])).map((n) => toChromeNode(n as BookmarkNode, nextId)),
  };
  const other = { id: "2", type: "folder", name: "Other bookmarks", children: [] as any[] };
  const synced = { id: "3", type: "folder", name: "Mobile bookmarks", children: [] as any[] };

  const roots = { bookmark_bar: bookmarkBar, other, synced };
  const file = { checksum: computeChecksum(roots), roots, version: 1 };
  writeFileSync(join(profileDir, "Bookmarks"), JSON.stringify(file));

  stripBookmarkMac(profileDir);
}

/** Remove the bookmarks MAC from Local State so Chrome recomputes it. */
function stripBookmarkMac(profileDir: string): void {
  // Local State lives in the User Data dir (parent of the profile dir).
  const localState = join(dirname(profileDir), "Local State");
  if (!existsSync(localState)) return;
  try {
    const json = JSON.parse(readFileSync(localState, "utf8"));
    if (json?.protection?.macs?.bookmarks) {
      delete json.protection.macs.bookmarks;
      writeFileSync(localState, JSON.stringify(json));
    }
  } catch {
    // If Local State is unreadable, the backup still protects the user.
  }
}
