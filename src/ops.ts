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
import { loadBundle, BundleVersionError } from "./core/bundle.ts";
import { backup, restore } from "./core/backup.ts";
import { isRunning } from "./core/guard.ts";
import { CHROMIUM_ADAPTERS } from "./adapters/chromium.ts";
import { GECKO_ADAPTERS } from "./adapters/gecko.ts";
import { SAFARI_ADAPTERS } from "./adapters/safari.ts";

export const ADAPTERS: Adapter[] = [...CHROMIUM_ADAPTERS, ...GECKO_ADAPTERS, ...SAFARI_ADAPTERS];
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
  error?: string;
}

export async function doctor(): Promise<DoctorRow[]> {
  const rows: DoctorRow[] = [];
  for (const a of ADAPTERS) {
    const dir = a.profileDir();
    if (!dir) continue;
    const row: DoctorRow = { id: a.id, label: a.label, bookmarks: null, history: null, tabs: null };
    try {
      const data = await a.read(dir);
      row.bookmarks = countBookmarks(data.bookmarks);
      row.history = data.history.length;
      row.tabs = data.tabs.length;
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
  skipped: string[];
}

export async function exportProfile(fromId: string, outDir: string): Promise<ExportResult> {
  const a = byId(fromId);
  if (!a) throw new OpError(`unknown browser: ${fromId}`);
  const dir = a.profileDir();
  if (!dir) throw new OpError(`${a.label} not installed / no profile found`);

  let data: Intermediate = { bookmarks: [], history: [], tabs: [] };
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
    },
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(outDir, "bookmarks.json"), JSON.stringify(data.bookmarks, null, 2));
  writeFileSync(join(outDir, "bookmarks.html"), toNetscapeHtml(data.bookmarks));
  writeFileSync(join(outDir, "history.json"), JSON.stringify(data.history, null, 2));
  writeFileSync(join(outDir, "tabs.json"), JSON.stringify(data.tabs, null, 2));
  writeFileSync(join(outDir, "tabs.html"), tabsToHtml(data.tabs));

  return {
    source: a.id,
    outDir,
    bookmarks: manifest.counts.bookmarks,
    history: manifest.counts.history,
    tabs: manifest.counts.tabs,
    skipped,
  };
}

export interface WriteResult {
  dest: string;
  bookmarks: number;
  dryRun: boolean;
  backupDir?: string;
}

async function writeInto(dest: Adapter, data: Intermediate, dryRun: boolean): Promise<WriteResult> {
  if (!dest.write || !dest.writableFiles) throw new OpError(`${dest.label} does not support writing`);
  const dir = dest.profileDir();
  if (!dir) throw new OpError(`${dest.label} not installed / no profile found`);
  const n = countBookmarks(data.bookmarks);

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
  const w = await writeInto(to, { bookmarks: loaded.bookmarks, history: [], tabs: [] }, dryRun);
  return { ...w, source: loaded.manifest.source, version: loaded.manifest.version };
}

export function restoreBackup(dir: string): string[] {
  return restore(dir);
}
