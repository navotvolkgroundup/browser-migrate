# browser-migrate

Move your browser profile (bookmarks, history, tabs) between browsers. macOS, CLI.

You test a lot of browsers — Chrome, Arc, Dia, Comet, Helium, Firefox, Zen, Safari — and switching means leaving your browsing life behind in the old one. This moves it.

## Status: M4 (Chromium + Firefox/Zen + Safari; bookmarks, history, tabs)

Supported for **read/export**: Chrome, Dia, Brave, Edge (Chromium); Firefox, Zen
(Gecko); Safari (WebKit). Data types: bookmarks + history everywhere; tabs from
Gecko (mozLz4 sessions) and Safari. Direct bookmark **write** currently targets
Chromium; other engines are read/export-only (write is future work).

Safari reads require **Full Disk Access** (grant it to your terminal in System
Settings → Privacy & Security). Without it, `doctor` says so instead of failing.

The bundle format is documented in [FORMAT.md](FORMAT.md).


```
browser-migrate list                          # supported + installed browsers
browser-migrate doctor                         # bookmark / history counts per browser
browser-migrate export <browser> <outDir>      # export a profile to a portable bundle
browser-migrate migrate --from <a> --to <b>    # copy bookmarks a → b   [--dry-run]
browser-migrate import  --in <dir>  --to <b>   # import a bundle → b    [--dry-run]
browser-migrate restore <backupDir>            # undo a write
browser-migrate extensions <browser>           # list installed extensions + store links
browser-migrate extensions <a> --open <b>      # open a's extension store pages in b
```

**Extensions** can't be migrated as data (they're installed programs; state is keyed
to per-browser IDs, and browsers block silent install). `browser-migrate` reads the
installed list and gives store links — `extensions <a> --open <b>` opens each store
page in the destination browser so you just click Install. Same-engine reuses the
store ID; cross-engine is a name match (different store).

**Two migration paths:**
1. **Portable / universal** — `export` writes a bundle (`manifest.json`,
   `bookmarks.json`, `history.json`, `bookmarks.html`). The Netscape `bookmarks.html`
   imports into any browser via its UI. Zero risk.
2. **Direct** — `migrate`/`import` write bookmarks straight into a Chromium profile.
   Every write: (a) refuses while the dest browser is running, (b) backs up the
   profile first (`~/.browser-migrate/backups`, undo with `restore`), (c) writes a
   `Bookmarks` file with a correct Chrome checksum and strips the stale MAC from
   `Local State` so Chrome accepts it. The checksum algorithm is verified against a
   real Chrome `Bookmarks` file.

Import enforces the bundle version policy: same major proceeds, newer-major is
refused (upgrade the tool), older-major proceeds.

**Cross-machine:** the export bundle is machine-independent — `export` on your old
Mac, copy the bundle dir over, `import` (or open `bookmarks.html`) on the new one.
Passwords never travel in a bundle (they'd be plaintext and Keychain is machine-bound).

## MCP server (drive it from Claude)

The same operations are exposed as MCP tools so Claude (or any MCP client) can run
them directly. Register with Claude Code:

```
claude mcp add browser-migrate -- bun run /ABSOLUTE/PATH/browser-migrate/src/mcp.ts
```

Or add to a client's `mcpServers` config:

```json
{ "browser-migrate": { "command": "bun", "args": ["run", "/ABSOLUTE/PATH/src/mcp.ts"] } }
```

Tools: `list_browsers`, `doctor`, `export_profile`, `migrate`, `import_bundle`,
`restore`. Writing tools (`migrate`, `import_bundle`) back up first and refuse while
the destination browser is running — the same safety as the CLI. Preview with
`dryRun: true`.

## Architecture

Hub-and-spoke. One adapter per browser reads into a neutral intermediate format;
export writes out of it. Adding a browser is one adapter file — N+M, not N×M.

```
source profile ─(adapter.read)─▶ Intermediate ─(export)─▶ bundle + bookmarks.html
```

- `src/core/intermediate.ts` — neutral format + `epochToUnixMs` (the one place
  the three engine time formats get normalized).
- `src/core/adapter.ts` — `Adapter` interface + `capabilities` matrix.
- `src/adapters/chromium.ts` — Chrome/Dia/Brave/Edge (shared Chromium layout).
- `src/adapters/gecko.ts` — Firefox/Zen (`places.sqlite`, profiles.ini, mozLz4 tabs).
- `src/adapters/safari.ts` — Safari (plist via `plutil`, History.db, FDA-aware).

## Roadmap

- **M2 ✓** — direct `migrate`/`import` behind backup+guard, Chromium checksum +
  `Local State` MAC strip, `--dry-run`, `restore`, bundle version policy.
- **M3 ✓** — Firefox/Zen adapters (`places.sqlite` bookmarks + history, epoch +
  `place:` filtering), cross-machine via portable bundle.
- **M4 ✓** — Safari read (plist bookmarks + Core-Data history, FDA-aware); tabs in
  the neutral format; Gecko tabs via a hand-rolled `mozLz4` decoder; `FORMAT.md`.

**Deferred, on purpose (with reasons):**
- **Arc** — bookmarks live in an undocumented `StorableSidebar.json`. Not built
  blind; needs a real Arc profile to verify against (wasn't installed here).
- **Chromium open-tab read** — SNSS is an append-only pickled binary format; a
  real spike. Gecko/Safari tabs work today.
- **Non-Chromium bookmark write** and **Safari/Gecko write** — writing
  `places.sqlite` / Safari plists is risky and unverifiable without writing into
  a live browser; these stay read/export-only until the write can be verified.

Known ceiling (M2): the `Local State` MAC strip is the pragmatic approach; Chrome's
exact reset behavior is version-dependent, which is why every write is backed up.
Live-Chrome acceptance across versions is a manual spike. The checksum is verified.

Passwords ride native CSV export/import (never reimplement browser crypto) and
are excluded from bundles by default.

## Develop

```
bun install
bun test
bun run src/cli.ts list
bun run compile     # single binary → ./browser-migrate
```

MIT.
