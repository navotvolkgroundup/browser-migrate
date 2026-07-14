import { Database } from "bun:sqlite";
import {
  existsSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { type Adapter, type Capabilities, AdapterDataError } from "../core/adapter.ts";
import {
  type BookmarkNode,
  type HistoryRow,
  type Intermediate,
  epochToUnixMs,
} from "../core/intermediate.ts";

// Firefox-family (Gecko). Bookmarks + history both live in places.sqlite.
// Zen is Firefox-based: same schema, different base dir.
// ponytail: read-only for now. Tabs (sessionstore recovery.jsonlz4, custom
// mozLz4) and bookmark WRITE are deferred — places.sqlite writes need FK/
// moz_origins/GUID handling, a separate task behind backup-before-write.

const CAPS: Capabilities = { bookmarks: "read", history: "read", tabs: "none", passwords: "none" };

// Fixed GUIDs of the permanent bookmark roots (stable across Firefox versions).
const ROOT_GUIDS = ["toolbar_____", "menu________", "unfiled_____", "mobile______"];

/** Resolve the active profile dir from profiles.ini, else newest places.sqlite. */
function defaultProfile(base: string): string | null {
  const iniPath = join(base, "profiles.ini");
  if (existsSync(iniPath)) {
    const ini = parseIni(readFileSync(iniPath, "utf8"));
    // Prefer the [Install*] Default= (the profile Firefox actually launches).
    for (const [name, sec] of Object.entries(ini)) {
      if (name.startsWith("Install") && sec.Default) {
        const p = join(base, sec.Default);
        if (existsSync(join(p, "places.sqlite"))) return p;
      }
    }
    // Else a [ProfileN] flagged Default=1.
    for (const [name, sec] of Object.entries(ini)) {
      if (name.startsWith("Profile") && sec.Default === "1" && sec.Path) {
        const p = sec.IsRelative === "0" ? sec.Path : join(base, sec.Path);
        if (existsSync(join(p, "places.sqlite"))) return p;
      }
    }
  }
  // Fallback: newest places.sqlite under Profiles/.
  const profilesDir = join(base, "Profiles");
  if (!existsSync(profilesDir)) return null;
  let best: { dir: string; mtime: number } | null = null;
  for (const entry of readdirSync(profilesDir)) {
    const places = join(profilesDir, entry, "places.sqlite");
    if (existsSync(places)) {
      const m = statSync(places).mtimeMs;
      if (!best || m > best.mtime) best = { dir: join(profilesDir, entry), mtime: m };
    }
  }
  return best?.dir ?? null;
}

function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) {
      section = m[1];
      out[section] = {};
    } else if (section) {
      const eq = line.indexOf("=");
      if (eq > 0) out[section][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return out;
}

/** Copy places.sqlite (+ WAL/SHM) to a temp dir and open readonly. */
function openReadonly(placesPath: string): Database {
  const dir = mkdtempSync(join(tmpdir(), "bm-gecko-"));
  const dest = join(dir, "places.sqlite");
  copyFileSync(placesPath, dest);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(placesPath + suffix)) copyFileSync(placesPath + suffix, dest + suffix);
  }
  return new Database(dest, { readonly: true });
}

function readBookmarks(db: Database): BookmarkNode[] {
  const rows = db
    .query(
      `SELECT b.id, b.type, b.parent, b.title, b.dateAdded, b.guid, p.url
       FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id
       ORDER BY b.parent, b.position`,
    )
    .all() as any[];

  const childrenOf = new Map<number, any[]>();
  const guidToId = new Map<string, number>();
  for (const r of rows) {
    if (!childrenOf.has(r.parent)) childrenOf.set(r.parent, []);
    childrenOf.get(r.parent)!.push(r);
    if (r.guid) guidToId.set(r.guid, r.id);
  }

  const build = (parentId: number): BookmarkNode[] => {
    const out: BookmarkNode[] = [];
    for (const r of childrenOf.get(parentId) ?? []) {
      if (r.type === 2) {
        out.push({ type: "folder", name: r.title ?? "", children: build(r.id) });
      } else if (r.type === 1 && r.url && !r.url.startsWith("place:")) {
        // Skip `place:` smart-bookmark queries — Firefox-internal, not portable.
        out.push({
          type: "url",
          name: r.title ?? r.url,
          url: r.url,
          addedMs: r.dateAdded ? epochToUnixMs("firefox", Number(r.dateAdded)) : undefined,
        });
      }
      // type 3 (separator) skipped.
    }
    return out;
  };

  const roots: BookmarkNode[] = [];
  for (const guid of ROOT_GUIDS) {
    const id = guidToId.get(guid);
    if (id == null) continue;
    const children = build(id);
    if (children.length) {
      const row = rows.find((r) => r.id === id);
      roots.push({ type: "folder", name: row?.title || guid, children });
    }
  }
  return roots;
}

function readHistory(db: Database): HistoryRow[] {
  const rows = db
    .query(
      `SELECT url, title, visit_count, last_visit_date FROM moz_places
       WHERE visit_count > 0 AND last_visit_date IS NOT NULL
       ORDER BY last_visit_date DESC`,
    )
    .all() as any[];
  return rows.map((r) => ({
    url: r.url,
    title: r.title ?? "",
    visitMs: epochToUnixMs("firefox", Number(r.last_visit_date)),
    visitCount: r.visit_count ?? 0,
  }));
}

function gecko(id: string, label: string, relBase: string, processName: string): Adapter {
  const base = join(homedir(), "Library", "Application Support", relBase);
  return {
    id,
    label,
    engine: "firefox",
    capabilities: CAPS,
    processName,
    profileDir() {
      return defaultProfile(base);
    },
    async read(dir: string): Promise<Intermediate> {
      const placesPath = join(dir, "places.sqlite");
      if (!existsSync(placesPath)) throw new AdapterDataError("bookmarks", "no places.sqlite");
      let db: Database;
      try {
        db = openReadonly(placesPath);
      } catch (e) {
        throw new AdapterDataError("bookmarks", `cannot open places.sqlite: ${e}`, e);
      }
      try {
        return { bookmarks: readBookmarks(db), history: readHistory(db) };
      } catch (e) {
        throw new AdapterDataError("history", `places.sqlite read failed: ${e}`, e);
      } finally {
        db.close();
      }
    },
  };
}

export const GECKO_ADAPTERS: Adapter[] = [
  gecko("firefox", "Firefox", "Firefox", "firefox"),
  gecko("zen", "Zen", "zen", "zen"),
];
