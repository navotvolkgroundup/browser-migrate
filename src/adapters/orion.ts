import { Database } from "bun:sqlite";
import { existsSync, copyFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { type Adapter, type Capabilities, AdapterDataError } from "../core/adapter.ts";
import type { HistoryRow, Intermediate } from "../core/intermediate.ts";

// Orion (Kagi, WebKit, macOS). Unusual: it installs BOTH Chrome Web Store and
// Firefox add-ons, so `extensions --open orion` opens the real store pages.
// History is a plain SQLite whose timestamps are string datetimes ("2026-08-04
// 07:08:34" UTC), not an epoch integer. Bookmarks live in favourites.plist (a
// binary keyed plist with date fields) — reading it is deferred; Orion is used
// here as a migration DEST via assisted HTML import, which needs no read.

const CAPS: Capabilities = { bookmarks: "read", history: "read", tabs: "none", passwords: "none" };
const BASE = join(homedir(), "Library", "Application Support", "Orion", "Defaults");

function parseOrionTime(s: string): number {
  // Stored as "YYYY-MM-DD HH:MM:SS" in UTC.
  const ms = Date.parse(s.replace(" ", "T") + "Z");
  return Number.isFinite(ms) ? ms : 0;
}

function readHistory(dir: string): HistoryRow[] {
  const path = join(dir, "history");
  if (!existsSync(path)) return [];
  const tmp = join(mkdtempSync(join(tmpdir(), "bm-orion-")), "history");
  try {
    copyFileSync(path, tmp);
    for (const s of ["-wal", "-shm"]) if (existsSync(path + s)) copyFileSync(path + s, tmp + s);
    const db = new Database(tmp, { readonly: true });
    try {
      const rows = db
        .query(
          "SELECT URL, TITLE, VISIT_COUNT, LAST_VISIT_TIME FROM history_items WHERE VISIT_COUNT > 0 ORDER BY LAST_VISIT_TIME DESC",
        )
        .all() as any[];
      return rows.map((r) => ({
        url: r.URL,
        title: r.TITLE ?? "",
        visitMs: parseOrionTime(r.LAST_VISIT_TIME),
        visitCount: r.VISIT_COUNT ?? 0,
      }));
    } finally {
      db.close();
    }
  } catch (e) {
    throw new AdapterDataError("history", `Orion history read failed: ${e}`, e);
  }
}

export const ORION_ADAPTERS: Adapter[] = [
  {
    id: "orion",
    label: "Orion",
    engine: "safari", // WebKit; no safe direct write -> assisted HTML import as a dest
    capabilities: CAPS,
    processName: "Orion",
    extensionCompat: ["chrome", "firefox"], // Orion installs CWS + AMO extensions directly
    profileDir() {
      return existsSync(BASE) ? BASE : null;
    },
    async read(dir: string): Promise<Intermediate> {
      // favourites.plist bookmark read deferred (binary keyed plist w/ date fields).
      return { bookmarks: [], history: readHistory(dir), tabs: [], extensions: [] };
    },
  },
];
