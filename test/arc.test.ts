import { expect, test } from "bun:test";
import { parseArcBookmarks } from "../src/core/arc-sidebar.ts";

// SYNTHETIC fixture based on the documented StorableSidebar shape. NOT a real
// Arc file — see issue #1. Verifies the parser extracts tab URLs and dedups.
test("parseArcBookmarks extracts pinned tab URLs from containers", () => {
  const json = {
    sidebar: {
      containers: [
        { global: true },
        {
          items: [
            "id-string-1",
            { id: "a", data: { tab: { savedURL: "https://bun.sh", savedTitle: "Bun" } } },
            "id-string-2",
            { id: "b", data: { list: {} } }, // folder, no url -> skipped
            { id: "c", data: { tab: { savedURL: "https://arc.net", savedTitle: "Arc" } } },
            { id: "d", data: { tab: { savedURL: "https://bun.sh" } } }, // dup -> skipped
          ],
        },
      ],
    },
  };
  const bms = parseArcBookmarks(json);
  expect(bms.map((b: any) => b.url)).toEqual(["https://bun.sh", "https://arc.net"]);
  expect((bms[0] as any).name).toBe("Bun");
});
