import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GECKO_ADAPTERS } from "../src/adapters/gecko.ts";
import { countBookmarks } from "../src/core/intermediate.ts";

// Build a minimal places.sqlite matching Firefox's schema, then round-trip it.
function fixtureProfile(): string {
  const dir = mkdtempSync(join(tmpdir(), "bm-ff-"));
  const db = new Database(join(dir, "places.sqlite"));
  db.run(
    "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER)",
  );
  db.run(
    "CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, parent INTEGER, position INTEGER, title TEXT, fk INTEGER, dateAdded INTEGER, guid TEXT)",
  );
  // places: a real URL (visited) and a place: smart-query target (unvisited)
  db.run("INSERT INTO moz_places VALUES (10,'https://bun.sh','Bun',3,?)", [100 * 1_000_000]);
  db.run("INSERT INTO moz_places VALUES (11,'place:sort=8','Most Visited',0,NULL)");
  // bookmark tree: root(1) → toolbar(2) → [Bun(3), Most Visited place: (4)]
  db.run("INSERT INTO moz_bookmarks VALUES (1,2,0,0,'',NULL,0,'root________')");
  db.run("INSERT INTO moz_bookmarks VALUES (2,2,1,0,'Bookmarks Toolbar',NULL,0,'toolbar_____')");
  db.run("INSERT INTO moz_bookmarks VALUES (3,1,2,0,'Bun',10,?,'aaaaaaaaaaaa')", [200 * 1_000_000]);
  db.run("INSERT INTO moz_bookmarks VALUES (4,1,2,1,'Most Visited',11,0,'bbbbbbbbbbbb')");
  db.close();
  return dir;
}

const firefox = GECKO_ADAPTERS.find((a) => a.id === "firefox")!;

test("reads Firefox bookmarks and filters place: smart queries", async () => {
  const data = await firefox.read(fixtureProfile());
  // Only "Bun" survives; the place: query is dropped.
  expect(countBookmarks(data.bookmarks)).toBe(1);
});

test("reads Firefox history with normalized Unix-ms timestamps", async () => {
  const data = await firefox.read(fixtureProfile());
  expect(data.history).toHaveLength(1);
  expect(data.history[0].url).toBe("https://bun.sh");
  expect(data.history[0].visitMs).toBe(100_000); // 100s (µs/1000)
});
