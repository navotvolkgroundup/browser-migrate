// The neutral format every adapter reads into and writes out of.
// N browsers + M data types collapse to N+M by normalizing here.
//
//   source profile ─(read)─▶ Intermediate ─(write / export)─▶ dest / bundle
//
// visit_time is ALWAYS Unix milliseconds UTC. Each engine stores time
// differently; epochToUnixMs is the one place that conversion lives.

export const FORMAT_VERSION = 1; // major. import refuses a newer major (see cli import).

export type BookmarkNode =
  | { type: "folder"; name: string; children: BookmarkNode[] }
  | { type: "url"; name: string; url: string; addedMs?: number };

export interface HistoryRow {
  url: string;
  title: string;
  visitMs: number; // Unix ms UTC
  visitCount: number;
}

export interface Intermediate {
  bookmarks: BookmarkNode[]; // top-level roots flattened into one list
  history: HistoryRow[];
  // tabs/passwords come in later milestones; adapters declare what they support.
}

export interface Manifest {
  version: number;
  source: string; // browser id the bundle came from
  createdMs: number;
  counts: { bookmarks: number; history: number };
}

// --- epoch conversion (the single most bug-prone field) -------------------
// Chromium: microseconds since 1601-01-01
// Firefox : microseconds since 1970-01-01
// Safari  : seconds since 2001-01-01 (Core Data)
const SEC_1601_TO_1970 = 11644473600;
const SEC_1970_TO_2001 = 978307200;

export type Engine = "chromium" | "firefox" | "safari";

export function epochToUnixMs(engine: Engine, raw: number): number {
  switch (engine) {
    case "chromium":
      return Math.round(raw / 1000) - SEC_1601_TO_1970 * 1000;
    case "firefox":
      return Math.round(raw / 1000);
    case "safari":
      return Math.round((raw + SEC_1970_TO_2001) * 1000);
  }
}

export function countBookmarks(nodes: BookmarkNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "url") n++;
    else n += countBookmarks(node.children);
  }
  return n;
}
