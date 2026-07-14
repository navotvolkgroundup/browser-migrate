import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { type Adapter, type Capabilities, AdapterDataError } from "../core/adapter.ts";
import type { Intermediate } from "../core/intermediate.ts";
import { parseArcBookmarks } from "../core/arc-sidebar.ts";
import { readHistory } from "./chromium.ts";

// Arc (Chromium engine, macOS-only). Bookmarks from StorableSidebar.json;
// history from the standard Chromium History DB under User Data/Default.
// UNVERIFIED against real Arc — see src/core/arc-sidebar.ts and issue #1.

const CAPS: Capabilities = { bookmarks: "read", history: "read", tabs: "none", passwords: "none" };
const ARC_BASE = join(homedir(), "Library", "Application Support", "Arc");

export const ARC_ADAPTERS: Adapter[] = [
  {
    id: "arc",
    label: "Arc",
    engine: "chromium",
    capabilities: CAPS,
    processName: "Arc",
    profileDir() {
      return existsSync(join(ARC_BASE, "StorableSidebar.json")) ? ARC_BASE : null;
    },
    async read(base: string): Promise<Intermediate> {
      let bookmarks: Intermediate["bookmarks"] = [];
      try {
        const json = JSON.parse(readFileSync(join(base, "StorableSidebar.json"), "utf8"));
        bookmarks = parseArcBookmarks(json);
      } catch (e) {
        throw new AdapterDataError("bookmarks", `failed to parse StorableSidebar.json: ${e}`, e);
      }
      const histDir = join(base, "User Data", "Default");
      const history = existsSync(join(histDir, "History")) ? readHistory(histDir) : [];
      return { bookmarks, history, tabs: [], extensions: [] };
    },
  },
];
