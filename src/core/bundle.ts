import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FORMAT_VERSION, type BookmarkNode, type Manifest } from "./intermediate.ts";

export class BundleVersionError extends Error {}

export interface LoadedBundle {
  manifest: Manifest;
  bookmarks: BookmarkNode[];
}

/**
 * Read a bundle and enforce the version-mismatch policy (eng review decision):
 *   same major   → proceed
 *   newer major  → refuse (tool is too old)
 *   older major  → proceed (backward compatible)
 * No silent partial import on an unknown version.
 */
export function loadBundle(dir: string): LoadedBundle {
  const mPath = join(dir, "manifest.json");
  if (!existsSync(mPath)) throw new Error(`no manifest.json in ${dir}`);
  const manifest: Manifest = JSON.parse(readFileSync(mPath, "utf8"));

  if (typeof manifest.version !== "number") {
    throw new BundleVersionError("bundle manifest has no version");
  }
  if (manifest.version > FORMAT_VERSION) {
    throw new BundleVersionError(
      `bundle format v${manifest.version} is newer than this tool (v${FORMAT_VERSION}). Upgrade browser-migrate.`,
    );
  }
  // older or equal major: proceed.
  const bPath = join(dir, "bookmarks.json");
  const bookmarks: BookmarkNode[] = existsSync(bPath)
    ? JSON.parse(readFileSync(bPath, "utf8"))
    : [];
  return { manifest, bookmarks };
}
