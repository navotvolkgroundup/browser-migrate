# Bundle format

The neutral, browser-independent format `browser-migrate export` produces and
`import` consumes. Documented **as-built** for format version `1`. This is not
(yet) a stability guarantee for external adopters — the version field exists so
the tool can refuse formats it doesn't understand.

## Version policy

`manifest.json` carries an integer `version` (currently `1`). On import:

| Bundle vs tool | Behavior |
|----------------|----------|
| same major     | proceed |
| newer major    | **refuse** — "upgrade browser-migrate" |
| older major    | proceed (backward compatible) |

No silent partial import on an unrecognized version.

## Files in a bundle

A bundle is a directory (portable across machines):

| File | Purpose |
|------|---------|
| `manifest.json` | version, source browser, timestamp, counts |
| `bookmarks.json` | bookmark tree (neutral schema) |
| `bookmarks.html` | same bookmarks as Netscape HTML — importable by any browser's UI |
| `history.json` | visited URLs with normalized timestamps |
| `tabs.json` | currently-open tabs (where the source supports it) |
| `tabs.html` | tabs as a clickable links page (reopen by clicking) |
| `extensions.json` | installed extensions as a reinstall list |
| `extensions.html` | extensions as store links (click each to reinstall) |

Passwords never appear in a bundle: they would be plaintext on disk, and the
Keychain is machine-bound. Password migration stays native CSV, same-machine.

## Schemas

`manifest.json`
```json
{ "version": 1, "source": "chrome", "createdMs": 1720000000000,
  "counts": { "bookmarks": 42, "history": 1000, "tabs": 7 } }
```

`bookmarks.json` — array of nodes:
```ts
type BookmarkNode =
  | { type: "folder"; name: string; children: BookmarkNode[] }
  | { type: "url"; name: string; url: string; addedMs?: number };
```

`history.json` — array of:
```ts
{ url: string; title: string; visitMs: number; visitCount: number }
```

`tabs.json` — array of:
```ts
{ url: string; title: string }
```

`extensions.json` — array of:
```ts
{ id: string; name: string; storeUrl: string; enabled: boolean }
```
Extensions are a reinstall list, not installable data — install is a user click
in the destination browser's store (browsers block silent install).

## Time

Every timestamp (`addedMs`, `visitMs`, `createdMs`) is **Unix milliseconds UTC**.
Source engines differ and are converted on read (`epochToUnixMs`):

| Engine | Stored as |
|--------|-----------|
| Chromium | microseconds since 1601-01-01 |
| Firefox  | microseconds since 1970-01-01 |
| Safari   | seconds since 2001-01-01 (Core Data) |
