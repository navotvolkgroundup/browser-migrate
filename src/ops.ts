// Shared operations. The CLI formats these for humans; the MCP server returns
// them as structured tool results. One source of truth for the orchestration
// (guard → backup → write, version checks, per-type error isolation).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./core/adapter.ts";
import { AdapterDataError } from "./core/adapter.ts";
import {
  FORMAT_VERSION,
  type Intermediate,
  type Manifest,
  countBookmarks,
} from "./core/intermediate.ts";
import { toNetscapeHtml, tabsToHtml } from "./core/netscape.ts";
import { extensionsToHtml } from "./core/extensions.ts";
import { loadBundle, BundleVersionError } from "./core/bundle.ts";
import { backup, restore } from "./core/backup.ts";
import { isRunning } from "./core/guard.ts";
import { readFileSync, writeFileSync as writeFile } from "node:fs";
import { fromCsv, toCsv, type PwFormat } from "./core/passwords.ts";
import { storeSearchUrl } from "./core/extensions.ts";
import { CHROMIUM_ADAPTERS } from "./adapters/chromium.ts";
import { GECKO_ADAPTERS } from "./adapters/gecko.ts";
import { SAFARI_ADAPTERS } from "./adapters/safari.ts";
import { ARC_ADAPTERS } from "./adapters/arc.ts";

export const ADAPTERS: Adapter[] = [
  ...CHROMIUM_ADAPTERS,
  ...ARC_ADAPTERS,
  ...GECKO_ADAPTERS,
  ...SAFARI_ADAPTERS,
];
export const byId = (id: string) => ADAPTERS.find((a) => a.id === id);

export class OpError extends Error {}

export interface BrowserInfo {
  id: string;
  label: string;
  installed: boolean;
  capabilities: Adapter["capabilities"];
}

export function listBrowsers(): BrowserInfo[] {
  return ADAPTERS.map((a) => ({
    id: a.id,
    label: a.label,
    installed: a.profileDir() !== null,
    capabilities: a.capabilities,
  }));
}

export interface DoctorRow {
  id: string;
  label: string;
  bookmarks: number | null;
  history: number | null;
  tabs: number | null;
  extensions: number | null;
  error?: string;
}

export async function doctor(): Promise<DoctorRow[]> {
  const rows: DoctorRow[] = [];
  for (const a of ADAPTERS) {
    const dir = a.profileDir();
    if (!dir) continue;
    const row: DoctorRow = { id: a.id, label: a.label, bookmarks: null, history: null, tabs: null, extensions: null };
    try {
      const data = await a.read(dir);
      row.bookmarks = countBookmarks(data.bookmarks);
      row.history = data.history.length;
      row.tabs = data.tabs.length;
      row.extensions = data.extensions.length;
    } catch (e) {
      if (e instanceof AdapterDataError) row.error = `${e.dataType}: ${e.message}`;
      else throw e;
    }
    rows.push(row);
  }
  return rows;
}

export interface ExportResult {
  source: string;
  outDir: string;
  bookmarks: number;
  history: number;
  tabs: number;
  extensions: number;
  skipped: string[];
}

export async function exportProfile(fromId: string, outDir: string): Promise<ExportResult> {
  const a = byId(fromId);
  if (!a) throw new OpError(`unknown browser: ${fromId}`);
  const dir = a.profileDir();
  if (!dir) throw new OpError(`${a.label} not installed / no profile found`);

  let data: Intermediate = { bookmarks: [], history: [], tabs: [], extensions: [] };
  const skipped: string[] = [];
  try {
    data = await a.read(dir);
  } catch (e) {
    if (e instanceof AdapterDataError) skipped.push(e.dataType);
    else throw e;
  }

  mkdirSync(outDir, { recursive: true });
  const manifest: Manifest = {
    version: FORMAT_VERSION,
    source: a.id,
    createdMs: Date.now(),
    counts: {
      bookmarks: countBookmarks(data.bookmarks),
      history: data.history.length,
      tabs: data.tabs.length,
      extensions: data.extensions.length,
    },
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(outDir, "bookmarks.json"), JSON.stringify(data.bookmarks, null, 2));
  writeFileSync(join(outDir, "bookmarks.html"), toNetscapeHtml(data.bookmarks));
  writeFileSync(join(outDir, "history.json"), JSON.stringify(data.history, null, 2));
  writeFileSync(join(outDir, "tabs.json"), JSON.stringify(data.tabs, null, 2));
  writeFileSync(join(outDir, "tabs.html"), tabsToHtml(data.tabs));
  writeFileSync(join(outDir, "extensions.json"), JSON.stringify(data.extensions, null, 2));
  writeFileSync(join(outDir, "extensions.html"), extensionsToHtml(data.extensions));

  return {
    source: a.id,
    outDir,
    bookmarks: manifest.counts.bookmarks,
    history: manifest.counts.history,
    tabs: manifest.counts.tabs,
    extensions: manifest.counts.extensions,
    skipped,
  };
}

export interface WriteResult {
  dest: string;
  bookmarks: number;
  dryRun: boolean;
  backupDir?: string;
  // Assisted path (engines with no safe direct write): we drop a bookmarks.html
  // and tell the user the import clicks instead of poking the profile.
  assisted?: boolean;
  bundleDir?: string;
  importHow?: string;
}

// Native "Import Bookmarks (HTML)" entry points. Direct DB/plist writes for
// these engines are intentionally NOT shipped — too risky to verify, and the
// Netscape HTML import is lossless and safe.
const IMPORT_HOW: Record<string, string> = {
  firefox: "about:preferences → Import Data / Bookmarks Manager (Ctrl+Shift+O) → Import → Import Bookmarks from HTML",
  safari: "File → Import From → Bookmarks HTML File",
  chromium: "Bookmarks Manager → ⋮ → Import bookmarks",
};

async function writeInto(dest: Adapter, data: Intermediate, dryRun: boolean): Promise<WriteResult> {
  const n = countBookmarks(data.bookmarks);

  // No safe direct write for this engine → assisted HTML import.
  if (!dest.write || !dest.writableFiles) {
    const how = IMPORT_HOW[dest.engine] ?? "your browser's Import Bookmarks (HTML) menu";
    if (dryRun) return { dest: dest.id, bookmarks: n, dryRun: true, assisted: true, importHow: how };
    const bundleDir = join(process.cwd(), `browser-migrate-${dest.id}-import`);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, "bookmarks.html"), toNetscapeHtml(data.bookmarks));
    return { dest: dest.id, bookmarks: n, dryRun: false, assisted: true, bundleDir, importHow: how };
  }

  const dir = dest.profileDir();
  if (!dir) throw new OpError(`${dest.label} not installed / no profile found`);

  if (dryRun) return { dest: dest.id, bookmarks: n, dryRun: true };

  if (dest.processName && (await isRunning(dest.processName))) {
    throw new OpError(`${dest.label} is running. Quit it first (it would overwrite the migration on exit).`);
  }
  const backupDir = backup(dest.id, dest.writableFiles(dir), Date.now());
  await dest.write(dir, data);
  return { dest: dest.id, bookmarks: n, dryRun: false, backupDir };
}

export interface MigrateResult extends WriteResult {
  read: number;
  source: string;
}

export async function migrate(fromId: string, toId: string, dryRun: boolean): Promise<MigrateResult> {
  const from = byId(fromId);
  const to = byId(toId);
  if (!from) throw new OpError(`unknown source browser: ${fromId}`);
  if (!to) throw new OpError(`unknown dest browser: ${toId}`);
  const fromDir = from.profileDir();
  if (!fromDir) throw new OpError(`${from.label} not installed`);
  const data = await from.read(fromDir);
  const w = await writeInto(to, data, dryRun);
  return { ...w, read: countBookmarks(data.bookmarks), source: from.id };
}

export interface ImportResult extends WriteResult {
  source: string;
  version: number;
}

export async function importBundle(bundleDir: string, toId: string, dryRun: boolean): Promise<ImportResult> {
  const to = byId(toId);
  if (!to) throw new OpError(`unknown dest browser: ${toId}`);
  let loaded;
  try {
    loaded = loadBundle(bundleDir);
  } catch (e) {
    if (e instanceof BundleVersionError) throw new OpError(e.message);
    throw e;
  }
  const w = await writeInto(to, { bookmarks: loaded.bookmarks, history: [], tabs: [], extensions: [] }, dryRun);
  return { ...w, source: loaded.manifest.source, version: loaded.manifest.version };
}

export function restoreBackup(dir: string): string[] {
  return restore(dir);
}

const ENGINE_TO_PW_FORMAT: Record<string, PwFormat> = {
  chromium: "chromium",
  firefox: "firefox",
  safari: "safari",
};

export interface PasswordResult {
  count: number;
  dest: string;
  format: PwFormat;
  outPath: string;
}

/** Transform a browser-exported password CSV into the destination browser's
 *  import format. Never touches the browser or its crypto — import is a manual
 *  step in the browser UI. */
export function convertPasswords(inPath: string, destId: string, outPath: string): PasswordResult {
  const to = byId(destId);
  if (!to) throw new OpError(`unknown dest browser: ${destId}`);
  const format = ENGINE_TO_PW_FORMAT[to.engine];
  const records = fromCsv(readFileSync(inPath, "utf8"));
  if (records.length === 0) throw new OpError(`no password rows found in ${inPath} (is it a browser CSV export?)`);
  writeFile(outPath, toCsv(records, format));
  return { count: records.length, dest: to.id, format, outPath };
}

async function readOne(id: string, who: string) {
  const a = byId(id);
  if (!a) throw new OpError(`unknown ${who} browser: ${id}`);
  const dir = a.profileDir();
  if (!dir) throw new OpError(`${a.label} not installed`);
  return { adapter: a, data: await a.read(dir) };
}

export async function listExtensions(fromId: string) {
  const { data } = await readOne(fromId, "source");
  return data.extensions;
}

export interface OpenExtResult {
  dest: string;
  opened: number;
  engineMismatch: boolean;
}

/** Open each source extension's store page in the destination browser, so the
 *  user clicks Install on each. Silent install is not possible — browsers
 *  block it. Cross-engine (e.g. Chrome→Firefox) is a name-match, not reusable
 *  store IDs, so we flag the mismatch. */
export async function openExtensionsIn(fromId: string, destId: string): Promise<OpenExtResult> {
  const { adapter: from, data } = await readOne(fromId, "source");
  const to = byId(destId);
  if (!to) throw new OpError(`unknown dest browser: ${destId}`);
  const app = to.processName ?? to.label;
  const mismatch = from.engine !== to.engine;
  let opened = 0;
  for (const ext of data.extensions) {
    // Same engine: open the exact store page. Cross engine: search the dest's
    // store by name (the source store ID won't exist there).
    const url = mismatch ? storeSearchUrl(to.engine, ext.name) : ext.storeUrl;
    if (!url) continue;
    Bun.spawnSync(["open", "-a", app, url]);
    opened++;
  }
  return { dest: to.id, opened, engineMismatch: mismatch };
}
