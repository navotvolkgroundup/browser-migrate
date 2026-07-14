import type { Intermediate } from "./intermediate.ts";

// One adapter per browser. Adding a browser = one file implementing this.
// `capabilities` is load-bearing: `list`/`doctor`/`diff` and import-fidelity
// all read off it. A data type the adapter can't handle is declared, not
// silently skipped.

export type Support = "read" | "write" | "both" | "none";

export interface Capabilities {
  bookmarks: Support;
  history: Support;
  tabs: Support;
  passwords: Support;
}

export interface Adapter {
  id: string; // "chrome", "arc", "dia", ...
  label: string; // "Google Chrome"
  engine: "chromium" | "firefox" | "safari";
  capabilities: Capabilities;
  /** macOS process name for the running-browser guard (e.g. "Google Chrome"). */
  processName?: string;
  /** Absolute profile dir, or null if the browser isn't installed. */
  profileDir(): string | null;
  /** Read the profile into the neutral format. Per-type failures throw
   *  AdapterDataError so the caller can skip+report+continue, never abort. */
  read(profileDir: string): Promise<Intermediate>;
  /** Files this adapter writes — backed up before any write. */
  writableFiles?(profileDir: string): string[];
  /** Write the neutral format into the profile. Caller has already backed up
   *  and confirmed the browser is not running. */
  write?(profileDir: string, data: Intermediate): Promise<void>;
}

// Named error so one data type failing never aborts the whole migration.
export class AdapterDataError extends Error {
  constructor(
    public dataType: keyof Capabilities,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "AdapterDataError";
  }
}
