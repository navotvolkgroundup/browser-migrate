// Passwords never live in a bundle and we never touch browser crypto. Instead
// we transform the CSV a browser exports into the CSV the destination browser
// imports. The user runs both export and import through the browser UI — this
// just bridges the column-format differences. Plaintext on disk by design;
// the CLI warns and the file is the user's to delete.

export interface PwRecord {
  url: string;
  username: string;
  password: string;
  title?: string;
  note?: string;
}

export type PwFormat = "chromium" | "firefox" | "safari";

// --- minimal RFC-4180 CSV (handles quotes, escaped quotes, embedded commas/newlines)
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Parse an exported CSV into neutral records, auto-detecting the source format
 *  from its header row. */
export function fromCsv(text: string): PwRecord[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iUrl = col("url", "website", "login_uri");
  const iUser = col("username", "login_username", "user");
  const iPass = col("password", "login_password");
  const iTitle = col("name", "title");
  const iNote = col("note", "notes");
  const out: PwRecord[] = [];
  for (const r of rows.slice(1)) {
    if (iUrl < 0 || iPass < 0) break; // not a recognizable password CSV
    const rec: PwRecord = {
      url: r[iUrl] ?? "",
      username: iUser >= 0 ? r[iUser] ?? "" : "",
      password: r[iPass] ?? "",
    };
    if (iTitle >= 0 && r[iTitle]) rec.title = r[iTitle];
    if (iNote >= 0 && r[iNote]) rec.note = r[iNote];
    if (rec.url || rec.username) out.push(rec);
  }
  return out;
}

/** Serialize records into the CSV shape the destination browser imports. */
export function toCsv(records: PwRecord[], format: PwFormat): string {
  let header: string[];
  let rowOf: (r: PwRecord) => string[];
  switch (format) {
    case "chromium":
      header = ["name", "url", "username", "password", "note"];
      rowOf = (r) => [r.title ?? host(r.url), r.url, r.username, r.password, r.note ?? ""];
      break;
    case "firefox":
      header = ["url", "username", "password"];
      rowOf = (r) => [r.url, r.username, r.password];
      break;
    case "safari":
      header = ["Title", "URL", "Username", "Password", "Notes"];
      rowOf = (r) => [r.title ?? host(r.url), r.url, r.username, r.password, r.note ?? ""];
      break;
  }
  const lines = [header.join(",")];
  for (const r of records) lines.push(rowOf(r).map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
