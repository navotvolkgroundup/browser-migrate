import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// Backup-before-write is the load-bearing safety invariant. EVERY write path
// (import, migrate) calls backup() before touching a profile; restore() undoes
// the most recent one. Getting a write wrong must never mean lost data.

const BACKUP_ROOT = join(homedir(), ".browser-migrate", "backups");

interface BackupManifest {
  createdMs: number;
  browser: string;
  files: { original: string; saved: string }[];
}

/** Copy the given files to a timestamped backup dir. Returns the dir path. */
export function backup(browser: string, files: string[], nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, "-");
  const dir = join(BACKUP_ROOT, `${browser}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  const manifest: BackupManifest = { createdMs: nowMs, browser, files: [] };
  for (const f of files) {
    if (!existsSync(f)) continue;
    const saved = join(dir, basename(f));
    copyFileSync(f, saved);
    manifest.files.push({ original: f, saved });
  }
  writeFileSync(join(dir, "backup.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

/** Restore a backup dir's files to their original locations. */
export function restore(dir: string): string[] {
  const manifest: BackupManifest = JSON.parse(
    readFileSync(join(dir, "backup.json"), "utf8"),
  );
  const restored: string[] = [];
  for (const { original, saved } of manifest.files) {
    copyFileSync(saved, original);
    restored.push(original);
  }
  return restored;
}

export function backupRoot(): string {
  return BACKUP_ROOT;
}
