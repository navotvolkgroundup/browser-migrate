import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TabRow } from "../core/intermediate.ts";

// Chromium session files (Sessions/Session_<n>) are "SNSS": a 4-byte magic, an
// int32 version, then length-prefixed commands. Each command is [uint16 size]
// [uint8 id][pickle]. The pickle begins with a 4-byte payload-size header.
//
// We only need three command types (ids stable across Chromium history):
//   6  UpdateTabNavigation      -> [tabId][index][url(str)][title(str16)]
//   7  SetSelectedNavigationIndex-> [tabId][index]  (which nav is current)
//   16 TabClosed                -> [tabId]          (drop closed tabs)
// Take the selected (or highest) navigation per still-open tab.
// ponytail: best-effort. SNSS is undocumented and version-fragile; verified
// against a real Chrome session. Falls back to [] on any parse trouble.

const CMD_UPDATE_NAV = 6;
const CMD_SELECTED_INDEX = 7;
const CMD_TAB_CLOSED = 16;

class PickleReader {
  private off = 0;
  constructor(private buf: Buffer) {
    this.off = 4; // skip the 4-byte payload-size header
  }
  int(): number {
    const v = this.buf.readInt32LE(this.off);
    this.off += 4;
    return v;
  }
  str(): string {
    const len = this.buf.readInt32LE(this.off);
    this.off += 4;
    if (len < 0 || this.off + len > this.buf.length) throw new Error("bad string len");
    const s = this.buf.toString("utf8", this.off, this.off + len);
    this.off += (len + 3) & ~3; // 4-byte aligned
    return s;
  }
}

function newestSession(sessionsDir: string): string | null {
  if (!existsSync(sessionsDir)) return null;
  let best: { p: string; m: number } | null = null;
  for (const f of readdirSync(sessionsDir)) {
    if (!f.startsWith("Session_")) continue;
    const p = join(sessionsDir, f);
    const m = statSync(p).mtimeMs;
    if (!best || m > best.m) best = { p, m };
  }
  return best?.p ?? null;
}

export function readChromiumTabs(profileDir: string): TabRow[] {
  const file = newestSession(join(profileDir, "Sessions"));
  if (!file) return [];
  let buf: Buffer;
  try {
    buf = readFileSync(file);
  } catch {
    return [];
  }
  if (buf.length < 8 || buf.toString("latin1", 0, 4) !== "SNSS") return [];

  const url = new Map<string, string>(); // `${tabId}:${index}` -> url
  const selected = new Map<number, number>();
  const maxIndex = new Map<number, number>();
  const closed = new Set<number>();

  let off = 8; // magic + version
  try {
    while (off + 2 <= buf.length) {
      const len = buf.readUInt16LE(off);
      off += 2;
      if (len === 0 || off + len > buf.length) break;
      const content = buf.subarray(off, off + len);
      off += len;
      const id = content[0];
      const pr = new PickleReader(content.subarray(1) as Buffer);
      try {
        if (id === CMD_UPDATE_NAV) {
          const tabId = pr.int(), index = pr.int(), u = pr.str();
          url.set(`${tabId}:${index}`, u);
          maxIndex.set(tabId, Math.max(maxIndex.get(tabId) ?? -1, index));
        } else if (id === CMD_SELECTED_INDEX) {
          const tabId = pr.int(), index = pr.int();
          selected.set(tabId, index);
        } else if (id === CMD_TAB_CLOSED) {
          closed.add(pr.int());
        }
      } catch {
        // one malformed command shouldn't kill the whole parse
      }
    }
  } catch {
    return [];
  }

  const tabs: TabRow[] = [];
  const seen = new Set<string>();
  for (const [tabId, mx] of maxIndex) {
    if (closed.has(tabId)) continue;
    const idx = selected.get(tabId) ?? mx;
    const u = url.get(`${tabId}:${idx}`) ?? url.get(`${tabId}:${mx}`);
    if (!u || u.startsWith("chrome:") || u.startsWith("about:") || u === "") continue;
    if (seen.has(u)) continue;
    seen.add(u);
    tabs.push({ url: u, title: "" });
  }
  return tabs;
}
