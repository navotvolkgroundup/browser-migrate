import { expect, test } from "bun:test";
import { readChromiumTabs } from "../src/adapters/chromium-sessions.ts";

// SNSS is a real binary format verified against a live Chrome session in
// development; here we just assert the safe fallback for a missing dir.
test("readChromiumTabs returns [] when no Sessions dir exists", () => {
  expect(readChromiumTabs("/nonexistent/profile/dir")).toEqual([]);
});
