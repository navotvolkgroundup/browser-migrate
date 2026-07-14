import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadBundle, BundleVersionError } from "../src/core/bundle.ts";
import { backup, restore } from "../src/core/backup.ts";
import { writeBookmarks, computeChecksum } from "../src/adapters/chromium-write.ts";
import { CHROMIUM_ADAPTERS } from "../src/adapters/chromium.ts";
import { countBookmarks, FORMAT_VERSION } from "../src/core/intermediate.ts";

function bundleDir(version: number): string {
  const dir = mkdtempSync(join(tmpdir(), "bm-bundle-"));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ version, source: "chrome", createdMs: 0, counts: { bookmarks: 1, history: 0 } }),
  );
  writeFileSync(
    join(dir, "bookmarks.json"),
    JSON.stringify([{ type: "url", name: "Bun", url: "https://bun.sh" }]),
  );
  return dir;
}

test("loadBundle accepts same-version bundle", () => {
  const { bookmarks } = loadBundle(bundleDir(FORMAT_VERSION));
  expect(countBookmarks(bookmarks)).toBe(1);
});

test("loadBundle refuses a newer-major bundle", () => {
  expect(() => loadBundle(bundleDir(FORMAT_VERSION + 1))).toThrow(BundleVersionError);
});

test("backup then restore round-trips file contents", () => {
  const dir = mkdtempSync(join(tmpdir(), "bm-prof-"));
  const file = join(dir, "Bookmarks");
  writeFileSync(file, "ORIGINAL");
  const b = backup("chrome", [file], 1_700_000_000_000);
  writeFileSync(file, "CLOBBERED");
  expect(readFileSync(file, "utf8")).toBe("CLOBBERED");
  restore(b);
  expect(readFileSync(file, "utf8")).toBe("ORIGINAL");
});

test("writeBookmarks produces a self-consistent checksum that reads back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bm-write-"));
  const nodes = [
    { type: "url" as const, name: "Bun", url: "https://bun.sh" },
    { type: "folder" as const, name: "Dev", children: [{ type: "url" as const, name: "HN", url: "https://news.ycombinator.com" }] },
  ];
  writeBookmarks(dir, nodes);

  const written = JSON.parse(readFileSync(join(dir, "Bookmarks"), "utf8"));
  // The checksum Chrome will validate must match a recompute of what we wrote.
  expect(written.checksum).toBe(computeChecksum(written.roots));

  // And the adapter can read its own output back.
  const chrome = CHROMIUM_ADAPTERS.find((a) => a.id === "chrome")!;
  const back = await chrome.read(dir);
  expect(countBookmarks(back.bookmarks)).toBe(2);
});
