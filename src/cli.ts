#!/usr/bin/env bun
import { backupRoot } from "./core/backup.ts";
import {
  listBrowsers,
  doctor,
  exportProfile,
  migrate,
  importBundle,
  restoreBackup,
  OpError,
} from "./ops.ts";

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function cmdList() {
  console.log("Supported browsers (● installed, ○ not found):\n");
  for (const b of listBrowsers()) {
    const caps = Object.entries(b.capabilities)
      .filter(([, v]) => v !== "none")
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    console.log(`  ${b.installed ? "●" : "○"} ${b.id.padEnd(8)} ${b.label.padEnd(18)} ${caps}`);
  }
}

async function cmdDoctor() {
  const rows = await doctor();
  if (rows.length === 0) return console.log("No supported browsers found.");
  for (const r of rows) {
    const bm = r.bookmarks ?? "-", h = r.history ?? "-", t = r.tabs ?? "-";
    console.log(`  ${r.id.padEnd(8)} bookmarks:${String(bm).padStart(5)}  history:${String(h).padStart(7)}  tabs:${String(t).padStart(4)}` + (r.error ? `  (${r.error})` : ""));
  }
}

async function cmdExport(fromId: string, outDir: string) {
  const r = await exportProfile(fromId, outDir);
  console.log(`Exported ${r.source} → ${r.outDir}`);
  console.log(`  ${r.bookmarks} bookmarks, ${r.history} history rows, ${r.tabs} tabs`);
  console.log(`  bookmarks.html imports into any browser; tabs.html reopens tabs.`);
  if (r.skipped.length) console.log(`  skipped (unreadable): ${r.skipped.join(", ")}`);
}

async function cmdMigrate(fromId: string, toId: string, dryRun: boolean) {
  const r = await migrate(fromId, toId, dryRun);
  console.log(`Read ${r.read} bookmarks from ${r.source}.`);
  if (r.dryRun) return console.log(`[dry-run] would write ${r.bookmarks} bookmarks into ${r.dest} (backed up first).`);
  console.log(`Backed up → ${r.backupDir}`);
  console.log(`Wrote ${r.bookmarks} bookmarks into ${r.dest}.  Undo: browser-migrate restore "${r.backupDir}"`);
}

async function cmdImport(dir: string, toId: string, dryRun: boolean) {
  const r = await importBundle(dir, toId, dryRun);
  console.log(`Bundle from ${r.source}, format v${r.version}.`);
  if (r.dryRun) return console.log(`[dry-run] would write ${r.bookmarks} bookmarks into ${r.dest} (backed up first).`);
  console.log(`Backed up → ${r.backupDir}`);
  console.log(`Wrote ${r.bookmarks} bookmarks into ${r.dest}.  Undo: browser-migrate restore "${r.backupDir}"`);
}

function cmdRestore(dir: string) {
  const files = restoreBackup(dir);
  console.log(`Restored ${files.length} file(s):`);
  for (const f of files) console.log(`  ${f}`);
}

function usage() {
  console.log(`browser-migrate — move your browser profile between browsers (macOS)

Usage:
  browser-migrate list                          supported + installed browsers
  browser-migrate doctor                        bookmark/history counts per browser
  browser-migrate export <browser> <outDir>     export a profile to a portable bundle
  browser-migrate migrate --from <a> --to <b>   copy bookmarks a → b  [--dry-run]
  browser-migrate import --in <dir> --to <b>    import a bundle → b   [--dry-run]
  browser-migrate restore <backupDir>           undo a write

Writes are always backed up first and refuse to run while the dest browser is open.
Backups live in ${backupRoot()}.

MCP: run 'bun run src/mcp.ts' to expose these as tools for Claude etc.`);
}

// tiny flag parser: --key value  and  --dry-run
function flags(args: string[]): { pos: string[]; opt: Record<string, string>; dryRun: boolean } {
  const pos: string[] = [], opt: Record<string, string> = {};
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--")) opt[a.slice(2)] = args[++i];
    else pos.push(a);
  }
  return { pos, opt, dryRun };
}

const [cmd, ...rest] = process.argv.slice(2);
const f = flags(rest);
try {
  switch (cmd) {
    case "list": cmdList(); break;
    case "doctor": await cmdDoctor(); break;
    case "export":
      if (f.pos.length < 2) fail("usage: export <browser> <outDir>");
      await cmdExport(f.pos[0], f.pos[1]);
      break;
    case "migrate":
      if (!f.opt.from || !f.opt.to) fail("usage: migrate --from <a> --to <b> [--dry-run]");
      await cmdMigrate(f.opt.from, f.opt.to, f.dryRun);
      break;
    case "import":
      if (!f.opt.in || !f.opt.to) fail("usage: import --in <bundleDir> --to <b> [--dry-run]");
      await cmdImport(f.opt.in, f.opt.to, f.dryRun);
      break;
    case "restore":
      if (f.pos.length < 1) fail("usage: restore <backupDir>");
      cmdRestore(f.pos[0]);
      break;
    case undefined:
    case "-h":
    case "--help": usage(); break;
    default: fail(`unknown command: ${cmd}\n\nRun 'browser-migrate --help'`);
  }
} catch (e) {
  fail(e instanceof OpError ? e.message : String(e));
}
