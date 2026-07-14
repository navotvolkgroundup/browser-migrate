import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CHROMIUM_ADAPTERS } from "../src/adapters/chromium.ts";
import { countBookmarks } from "../src/core/intermediate.ts";
import { toNetscapeHtml } from "../src/core/netscape.ts";

// Build a minimal real Chromium profile dir on disk, then round-trip it
// through the adapter. This is the ship-at-2am fixture test.
function fixtureProfile(): string {
  const dir = mkdtempSync(join(tmpdir(), "bm-fixture-"));
  writeFileSync(
    join(dir, "Bookmarks"),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: "folder",
          name: "Bookmarks bar",
          children: [
            { type: "url", name: "Hacker News", url: "https://news.ycombinator.com", date_added: "13350000000000000" },
            {
              type: "folder",
              name: "Dev",
              children: [{ type: "url", name: "Bun", url: "https://bun.sh" }],
            },
          ],
        },
        other: { type: "folder", name: "Other", children: [] },
      },
      version: 1,
    }),
  );
  const db = new Database(join(dir, "History"));
  db.run(
    "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER)",
  );
  db.run(
    "INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES (?, ?, ?, ?)",
    ["https://bun.sh", "Bun", 5, (11644473600 + 100) * 1_000_000],
  );
  db.close();
  return dir;
}

const chrome = CHROMIUM_ADAPTERS.find((a) => a.id === "chrome")!;

test("reads bookmarks tree and counts leaves", async () => {
  const data = await chrome.read(fixtureProfile());
  expect(countBookmarks(data.bookmarks)).toBe(2);
});

test("reads history with normalized Unix-ms timestamps", async () => {
  const data = await chrome.read(fixtureProfile());
  expect(data.history).toHaveLength(1);
  expect(data.history[0].url).toBe("https://bun.sh");
  expect(data.history[0].visitMs).toBe(100_000); // 100s after Unix epoch
});

test("exports importable Netscape HTML", async () => {
  const data = await chrome.read(fixtureProfile());
  const html = toNetscapeHtml(data.bookmarks);
  expect(html).toContain("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
  expect(html).toContain('<A HREF="https://news.ycombinator.com"');
  expect(html).toContain("Bun");
});
