import { expect, test } from "bun:test";
import { epochToUnixMs, countBookmarks } from "../src/core/intermediate.ts";

// The single most bug-prone field. Anchor each engine to a known instant.
test("chromium epoch: 1970-01-01 maps to 0", () => {
  // Chrome stores µs since 1601. 1970-01-01 = 11644473600 s after 1601.
  expect(epochToUnixMs("chromium", 11644473600_000000)).toBe(0);
});

test("chromium epoch: one day after Unix epoch", () => {
  const oneDayUs = (11644473600 + 86400) * 1_000_000;
  expect(epochToUnixMs("chromium", oneDayUs)).toBe(86400_000);
});

test("firefox epoch: microseconds since 1970 → ms", () => {
  expect(epochToUnixMs("firefox", 1_000_000)).toBe(1000);
});

test("safari epoch: 2001-01-01 (0s) → ms since 1970", () => {
  expect(epochToUnixMs("safari", 0)).toBe(978307200_000);
});

test("countBookmarks walks folders recursively", () => {
  expect(
    countBookmarks([
      { type: "url", name: "a", url: "https://a" },
      {
        type: "folder",
        name: "f",
        children: [
          { type: "url", name: "b", url: "https://b" },
          { type: "url", name: "c", url: "https://c" },
        ],
      },
    ]),
  ).toBe(3);
});
