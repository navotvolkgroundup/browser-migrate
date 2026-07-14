import { expect, test } from "bun:test";
import { chromiumExtensions, firefoxExtensions } from "../src/core/extensions.ts";

const ID = "abcdefghijklmnopabcdefghijklmnop"; // 32 chars

test("chromiumExtensions keeps store extensions, drops components and themes", () => {
  const prefs = {
    extensions: {
      settings: {
        [ID]: { manifest: { name: "uBlock Origin" }, from_webstore: true, state: 1 },
        nmmhkkegccagdldgiimedpiccmgmieda: {
          manifest: { name: "Chrome Web Store Payments" },
          from_webstore: true,
          was_installed_by_default: true, // bundled component -> drop
          state: 1,
        },
        themekey1234567890themekey123456: { manifest: { name: "Dark Theme", theme: {} }, from_webstore: true },
        unpacked12345678901234567890abcd: { manifest: { name: "Dev ext" }, location: 6 }, // not from store
      },
    },
  };
  const rows = chromiumExtensions(prefs, {});
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe("uBlock Origin");
  expect(rows[0].storeUrl).toBe(`https://chromewebstore.google.com/detail/${ID}`);
  expect(rows[0].enabled).toBe(true);
});

test("chromiumExtensions merges Preferences and Secure Preferences", () => {
  const secure = { extensions: { settings: { [ID]: { manifest: { name: "X" }, from_webstore: true, state: 0 } } } };
  const rows = chromiumExtensions({}, secure);
  expect(rows).toHaveLength(1);
  expect(rows[0].enabled).toBe(false);
});

test("firefoxExtensions keeps profile extensions, drops system addons", () => {
  const extJson = {
    addons: [
      { id: "ubo@raymondhill.net", type: "extension", location: "app-profile", active: true, defaultLocale: { name: "uBlock Origin" } },
      { id: "sys@mozilla.org", type: "extension", location: "app-system-defaults", active: true, defaultLocale: { name: "System" } },
      { id: "theme@x", type: "theme", location: "app-profile", defaultLocale: { name: "Theme" } },
    ],
  };
  const rows = firefoxExtensions(extJson);
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe("uBlock Origin");
  expect(rows[0].storeUrl).toContain("addons.mozilla.org");
});
