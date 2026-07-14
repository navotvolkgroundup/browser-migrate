import { Database } from "bun:sqlite";
import { existsSync, copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  type Adapter,
  type Capabilities,
  AdapterDataError,
} from "../core/adapter.ts";
import { writeBookmarks } from "./chromium-write.ts";
import {
  type BookmarkNode,
  type HistoryRow,
  type Intermediate,
  epochToUnixMs,
} from "../core/intermediate.ts";

// Standard Chromium profile layout. Chrome/Dia/Comet/Helium share it.
// Arc does NOT (StorableSidebar.json) — separate adapter, not registered here.
// ponytail: bookmarks+history read only for M1; write path (Local State
// checksum/MAC) is deferred to M2 — getting it wrong resets the user's real
// bookmarks, so it goes behind backup-before-write, not in the first cut.

const CAPS: Capabilities = {
  bookmarks: "both", // read + write (write = M2, behind backup-before-write)
  history: "read",
  tabs: "none",
  passwords: "none",
};

function chromium(id: string, label: string, relDir: string, processName: string): Adapter {
  const base = join(homedir(), "Library", "Application Support", relDir);
  return {
    id,
    label,
    engine: "chromium",
    capabilities: CAPS,
    processName,
    profileDir() {
      return existsSync(join(base, "Bookmarks")) || existsSync(join(base, "History"))
        ? base
        : null;
    },
    async read(dir: string): Promise<Intermediate> {
      return {
        bookmarks: readBookmarks(dir),
        history: readHistory(dir),
      };
    },
    writableFiles(dir: string) {
      return [join(dir, "Bookmarks"), join(dirname(dir), "Local State")];
    },
    async write(dir: string, data: Intermediate) {
      writeBookmarks(dir, data.bookmarks);
    },
  };
}

function readBookmarks(dir: string): BookmarkNode[] {
  const path = join(dir, "Bookmarks");
  if (!existsSync(path)) return [];
  try {
    const json = JSON.parse(readFileSync(path, "utf8"));
    const roots = json.roots ?? {};
    const out: BookmarkNode[] = [];
    for (const key of ["bookmark_bar", "other", "synced"]) {
      const r = roots[key];
      if (r?.children) out.push(convert(r) as BookmarkNode);
    }
    return out;
  } catch (e) {
    throw new AdapterDataError("bookmarks", `failed to parse Bookmarks: ${e}`, e);
  }
}

function convert(node: any): BookmarkNode {
  if (node.type === "url") {
    return {
      type: "url",
      name: node.name ?? node.url,
      url: node.url,
      addedMs: node.date_added
        ? epochToUnixMs("chromium", Number(node.date_added))
        : undefined,
    };
  }
  return {
    type: "folder",
    name: node.name ?? "",
    children: (node.children ?? []).map(convert),
  };
}

function readHistory(dir: string): HistoryRow[] {
  const path = join(dir, "History");
  if (!existsSync(path)) return [];
  // Copy out first: Chrome holds a lock on the live DB (WAL). Reading a temp
  // copy readonly avoids "database is locked" while the browser is open.
  const tmp = join(mkdtempSync(join(tmpdir(), "bm-")), "History");
  try {
    copyFileSync(path, tmp);
    const db = new Database(tmp, { readonly: true });
    try {
      const rows = db
        .query(
          "SELECT url, title, visit_count, last_visit_time FROM urls ORDER BY last_visit_time DESC",
        )
        .all() as any[];
      return rows.map((r) => ({
        url: r.url,
        title: r.title ?? "",
        visitMs: epochToUnixMs("chromium", Number(r.last_visit_time)),
        visitCount: r.visit_count ?? 0,
      }));
    } finally {
      db.close();
    }
  } catch (e) {
    throw new AdapterDataError("history", `failed to read History: ${e}`, e);
  }
}

export const CHROMIUM_ADAPTERS: Adapter[] = [
  chromium("chrome", "Google Chrome", "Google/Chrome/Default", "Google Chrome"),
  chromium("dia", "Dia", "Dia/User Data/Default", "Dia"),
  chromium("brave", "Brave", "BraveSoftware/Brave-Browser/Default", "Brave Browser"),
  chromium("edge", "Microsoft Edge", "Microsoft Edge/Default", "Microsoft Edge"),
];
