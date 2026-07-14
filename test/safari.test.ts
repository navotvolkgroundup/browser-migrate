import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SAFARI_ADAPTERS } from "../src/adapters/safari.ts";
import { countBookmarks } from "../src/core/intermediate.ts";

// We can't read the real ~/Library/Safari without Full Disk Access, so verify
// the plist-parsing + Core-Data-epoch logic against fixtures instead.
function fixtureBase(): string {
  const base = mkdtempSync(join(tmpdir(), "bm-safari-fx-"));
  // Bookmarks.plist as XML (plutil reads XML plists too).
  writeFileSync(
    join(base, "Bookmarks.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
  <key>Children</key><array>
    <dict>
      <key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string>
      <key>URLString</key><string>https://bun.sh</string>
      <key>URIDictionary</key><dict><key>title</key><string>Bun</string></dict>
    </dict>
  </array>
</dict></plist>`,
  );
  // History.db matching Safari's schema.
  const db = new Database(join(base, "History.db"));
  db.run("CREATE TABLE history_items (id INTEGER PRIMARY KEY, url TEXT, visit_count INTEGER)");
  db.run("CREATE TABLE history_visits (id INTEGER PRIMARY KEY, history_item INTEGER, visit_time REAL, title TEXT)");
  db.run("INSERT INTO history_items VALUES (1,'https://bun.sh',4)");
  db.run("INSERT INTO history_visits VALUES (1,1,100.0,'Bun')"); // 100s after 2001
  db.close();
  return base;
}

const safari = SAFARI_ADAPTERS[0];

test("parses Safari bookmark plist via plutil", async () => {
  const data = await safari.read(fixtureBase());
  expect(countBookmarks(data.bookmarks)).toBe(1);
  const bm = data.bookmarks.find((n) => n.type === "url") as any;
  expect(bm.url).toBe("https://bun.sh");
  expect(bm.name).toBe("Bun");
});

test("reads Safari history with Core Data epoch normalized to Unix ms", async () => {
  const data = await safari.read(fixtureBase());
  expect(data.history).toHaveLength(1);
  // 100s after 2001-01-01 = (100 + 978307200) * 1000 ms
  expect(data.history[0].visitMs).toBe((100 + 978307200) * 1000);
});
