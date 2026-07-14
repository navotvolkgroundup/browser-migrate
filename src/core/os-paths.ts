import { homedir } from "node:os";
import { join } from "node:path";

// Per-OS profile base directories. macOS is verified; Windows/Linux paths are
// the documented standard locations but untested (see issue #5).

export type OS = "darwin" | "linux" | "win32";
export const CURRENT_OS = process.platform as OS;

const home = (...p: string[]) => join(homedir(), ...p);

/** Base dir the Chromium family stores profiles under, per OS. */
export function chromiumBase(): string {
  switch (CURRENT_OS) {
    case "darwin":
      return home("Library", "Application Support");
    case "win32":
      return process.env.LOCALAPPDATA ?? home("AppData", "Local");
    default: // linux
      return home(".config");
  }
}

/** Pick the value for the current OS from a partial map (undefined = unsupported here). */
export function forOS<T>(m: Partial<Record<OS, T>>): T | undefined {
  return m[CURRENT_OS];
}
