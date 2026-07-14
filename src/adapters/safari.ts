import { Database } from "bun:sqlite";
import { existsSync, copyFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { type Adapter, type Capabilities, AdapterDataError } from "../core/adapter.ts";
import {
  type BookmarkNode,
  type HistoryRow,
  type TabRow,
  type Intermediate,
  epochToUnixMs,
} from "../core/intermediate.ts";

// Safari (WebKit). Read-only / source-first. Bookmarks live in a binary plist
// (parsed with macOS's own `plutil`), history in a SQLite DB with Core Data
// timestamps (seconds since 2001). Everything under ~/Library/Safari is
// TCC-protected: without Full Disk Access, reads fail — we surface that as a
// clear, actionable error rather than a stack trace.
// ponytail: read-only. Safari write (SIP-protected, needs the app closed and
// TCC) is out of scope — Safari imports the bundle's bookmarks.html via its UI.

const CAPS: Capabilities = { bookmarks: "read", history: "read", tabs: "read", passwords: "none" };
const FDA_HINT =
  "Safari data needs Full Disk Access. Grant it to your terminal in " +
  "System Settings → Privacy & Security → Full Disk Access, then retry.";

function plutilToJson(path: string): any {
  const r = Bun.spawnSync(["plutil", "-convert", "json", "-o", "-", path]);
  if (r.exitCode !== 0) {
    const err = r.stderr.toString();
    if (/operation not permitted|permission/i.test(err)) throw new AdapterDataError("bookmarks", FDA_HINT);
    throw new AdapterDataError("bookmarks", `plutil failed: ${err.trim()}`);
  }
  return JSON.parse(r.stdout.toString());
}

function walkBookmarks(node: any): BookmarkNode | null {
  if (node?.WebBookmarkType === "WebBookmarkTypeLeaf" && node.URLString) {
    return { type: "url", name: node.URIDictionary?.title ?? node.URLString, url: node.URLString };
  }
  if (node?.WebBookmarkType === "WebBookmarkTypeList") {
    const children = (node.Children ?? []).map(walkBookmarks).filter(Boolean) as BookmarkNode[];
    return { type: "folder", name: node.Title ?? "", children };
  }
  return null;
}

function readBookmarks(base: string): BookmarkNode[] {
  const path = join(base, "Bookmarks.plist");
  if (!existsSync(path)) return [];
  const root = plutilToJson(path);
  const top = walkBookmarks(root);
  return top && top.type === "folder" ? top.children : [];
}

function readHistory(base: string): HistoryRow[] {
  const path = join(base, "History.db");
  if (!existsSync(path)) return [];
  const dir = mkdtempSync(join(tmpdir(), "bm-safari-"));
  const dest = join(dir, "History.db");
  try {
    copyFileSync(path, dest); // fails without FDA
    for (const s of ["-wal", "-shm"]) if (existsSync(path + s)) copyFileSync(path + s, dest + s);
  } catch (e) {
    throw new AdapterDataError("history", FDA_HINT, e);
  }
  const db = new Database(dest, { readonly: true });
  try {
    const rows = db
      .query(
        `SELECT hi.url AS url, MAX(hv.visit_time) AS vt, hi.visit_count AS vc,
                (SELECT title FROM history_visits WHERE history_item = hi.id AND title IS NOT NULL LIMIT 1) AS title
         FROM history_items hi JOIN history_visits hv ON hv.history_item = hi.id
         GROUP BY hi.id ORDER BY vt DESC`,
      )
      .all() as any[];
    return rows.map((r) => ({
      url: r.url,
      title: r.title ?? "",
      visitMs: epochToUnixMs("safari", Number(r.vt)),
      visitCount: r.vc ?? 0,
    }));
  } finally {
    db.close();
  }
}

function readTabs(base: string): TabRow[] {
  const path = join(base, "LastSession.plist");
  if (!existsSync(path)) return [];
  let session: any;
  try {
    session = plutilToJson(path);
  } catch {
    return []; // tabs are best-effort; don't fail the whole read
  }
  const tabs: TabRow[] = [];
  for (const win of session?.SessionWindows ?? []) {
    for (const tab of win?.TabStates ?? []) {
      if (tab?.TabURL && !tab.TabURL.startsWith("about:")) {
        tabs.push({ url: tab.TabURL, title: tab.TabTitle ?? tab.TabURL });
      }
    }
  }
  return tabs;
}

const SAFARI_BASE = join(homedir(), "Library", "Safari");

export const SAFARI_ADAPTERS: Adapter[] = [
  {
    id: "safari",
    label: "Safari",
    engine: "safari",
    capabilities: CAPS,
    processName: "Safari",
    profileDir() {
      // Safari is installed on every Mac; the dir may exist even if reads are
      // TCC-blocked. Report installed and let read() surface the FDA error.
      return existsSync(SAFARI_BASE) ? SAFARI_BASE : null;
    },
    async read(base: string): Promise<Intermediate> {
      return {
        bookmarks: readBookmarks(base),
        history: readHistory(base),
        tabs: readTabs(base),
        extensions: [], // Safari extensions are App Store apps — different model.
      };
    },
  },
];
