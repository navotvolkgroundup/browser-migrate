import { expect, test } from "bun:test";
import { parseCsv, fromCsv, toCsv } from "../src/core/passwords.ts";

test("parseCsv handles quotes, embedded commas and escaped quotes", () => {
  const rows = parseCsv('a,b,c\n"x,y","he said ""hi""",z\n');
  expect(rows).toEqual([
    ["a", "b", "c"],
    ["x,y", 'he said "hi"', "z"],
  ]);
});

test("reads a Chrome-format export and converts to Firefox format", () => {
  const chrome = 'name,url,username,password,note\nGitHub,https://github.com,octo,s3cr3t,\n';
  const recs = fromCsv(chrome);
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ url: "https://github.com", username: "octo", password: "s3cr3t" });

  const ff = toCsv(recs, "firefox");
  expect(ff.split("\n")[0]).toBe("url,username,password");
  expect(ff).toContain("https://github.com,octo,s3cr3t");
});

test("reads a Firefox-format export and converts to Chromium format", () => {
  const ff = 'url,username,password\nhttps://x.com,me,"pw,with,commas"\n';
  const recs = fromCsv(ff);
  const chrome = toCsv(recs, "chromium");
  expect(chrome.split("\n")[0]).toBe("name,url,username,password,note");
  // password containing commas must be quoted on the way out
  expect(chrome).toContain('"pw,with,commas"');
  // title defaults to the host when the source had none
  expect(chrome).toContain("x.com,https://x.com,me");
});

test("rejects a non-password CSV (no url/password columns) as empty", () => {
  expect(fromCsv("a,b\n1,2\n")).toEqual([]);
});
