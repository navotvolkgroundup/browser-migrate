import { expect, test } from "bun:test";
import { parseArcBookmarks } from "../src/core/arc-sidebar.ts";

// Fixture shape matches a real Arc StorableSidebar (verified): items interleaves
// id-strings and objects; tab objects carry data.tab.savedURL/savedTitle;
// itemContainer objects are spaces/folders.
test("parseArcBookmarks extracts tabs, drops folders/dupes/non-portable schemes", () => {
  const json = {
    sidebar: {
      containers: [
        { global: true },
        {
          items: [
            "id-1",
            { id: "a", data: { tab: { savedURL: "https://bun.sh", savedTitle: "Bun" } } },
            "id-2",
            { id: "b", data: { itemContainer: {} } }, // space/folder -> skip
            { id: "c", data: { tab: { savedURL: "https://arc.net", savedTitle: "Arc" } } },
            { id: "d", data: { tab: { savedURL: "https://bun.sh" } } }, // dup -> skip
            { id: "e", data: { tab: { savedURL: "chrome-extension://abc/x.html", savedTitle: "Ext" } } }, // skip
          ],
        },
      ],
    },
  };
  const bms = parseArcBookmarks(json);
  expect(bms.map((b: any) => b.url)).toEqual(["https://bun.sh", "https://arc.net"]);
  expect((bms[0] as any).name).toBe("Bun");
});
