# browser-migrate

Move your browser profile (bookmarks, history, tabs) between browsers. macOS, CLI.

You test a lot of browsers — Chrome, Arc, Dia, Comet, Helium, Firefox, Zen, Safari — and switching means leaving your browsing life behind in the old one. This moves it.

## Status: M3 (Chromium + Firefox/Zen, read + export + direct write)

Supported: Chrome, Dia, Brave, Edge (Chromium) and Firefox, Zen (Gecko) for
reading bookmarks + history. Direct bookmark write currently lands in Chromium
targets; Gecko is read/export-only (write is a later milestone).


```
browser-migrate list                          # supported + installed browsers
browser-migrate doctor                         # bookmark / history counts per browser
browser-migrate export <browser> <outDir>      # export a profile to a portable bundle
browser-migrate migrate --from <a> --to <b>    # copy bookmarks a → b   [--dry-run]
browser-migrate import  --in <dir>  --to <b>   # import a bundle → b    [--dry-run]
browser-migrate restore <backupDir>            # undo a write
```

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
- `src/adapters/gecko.ts` — Firefox/Zen (`places.sqlite`, profiles.ini resolution).

## Roadmap

- **M2 ✓** — direct `migrate`/`import` behind backup+guard, Chromium checksum +
  `Local State` MAC strip, `--dry-run`, `restore`, bundle version policy.
- **M3 ✓** — Firefox/Zen adapters (`places.sqlite` bookmarks + history, epoch +
  `place:` filtering), cross-machine via portable bundle.
- **M4** — Safari (source-first, Full Disk Access), Gecko bookmark write, tabs
  (Firefox `mozLz4` sessionstore + Chromium SNSS), `FORMAT.md`.

**Deferred, on purpose:**
- **Arc** — bookmarks live in an undocumented `StorableSidebar.json`. Not built
  blind; needs a real Arc profile to verify against (wasn't installed here).
- **Tabs** — the neutral format doesn't model tabs yet; it's its own milestone
  (Firefox `mozLz4`, Chromium SNSS, Safari session plist all differ).

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
